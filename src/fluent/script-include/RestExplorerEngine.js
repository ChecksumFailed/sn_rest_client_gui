var RestExplorerEngine = Class.create();
RestExplorerEngine.prototype = {

    // Role required to execute requests. A caller without it is refused before any
    // outbound call is made, so hitting the widget's server endpoint directly is not
    // enough -- the check lives here, not only on the page ACL.
    EXPLORER_ROLE: 'x_1676196_rest_gui.user',

    // Fallback MID server name, used only when a MID server is needed but none was
    // supplied and OAuthMidSelector did not return one. Configure per-instance.
    DEFAULT_MID_PROPERTY: 'x_1676196_rest_gui.default_mid_server',

    // Seconds of remaining token life below which we force a refresh instead of
    // reusing the cached token.
    TOKEN_MIN_TTL: 60,

    initialize: function() {},

    /**
     * Build and execute an outbound REST message, returning a normalized result.
     *
     * @param {Object} config
     *   config.source      {String}  'restMessage' (default) | 'url'
     *   config.restMessage {String}  sys_rest_message sys_id (preferred -- names are not
     *                                unique across scopes) or name (required when source='restMessage')
     *   config.method      {String}  sys_rest_message_fn name, e.g. "get" (required when source='restMessage')
     *   config.endpoint    {String}  full request URL (required when source='url')
     *   config.httpMethod  {String}  HTTP verb for a direct URL call, e.g. "get" (url only)
     *   config.authType    {String}  'basic' | 'apikey' | 'oauth' | 'none'
     *   config.authProfile {String}  sys_id of the auth profile (basic profile / oauth)
     *   config.basic       {Object}  { mode:'profile'|'manual', username, password } (basic only)
     *   config.requestorId {String}  OAuth requestor id (oauth only; getToken arg 1)
     *   config.midServer   {String}  MID server NAME, or falsy for a direct call
     *   config.apiKey      {Object}  { placement:'header'|'query', name, value } (apikey only)
     *   config.variables   {Object}  REST message variable name -> value (NoEscape substitution)
     *   config.headers     {Object}  extra request header name -> value
     *   config.body        {String}  request body for POST/PUT/PATCH
     *   config.timeout     {Number}  seconds to wait for a MID (async) response; default 60
     *
     * @returns {Object} { ok, status, headers, body, error }
     */
    execute: function(config) {
        // gs.hasRole() already returns true for admins on any role; the explicit admin
        // check is kept so the rule is visible here and holds under a mocked gs.
        if (!gs.hasRole(this.EXPLORER_ROLE) && !gs.hasRole('admin')) {
            return this._fail('You do not have the ' + this.EXPLORER_ROLE + ' role required to run Outbound REST Console.');
        }
        var useUrl = config.source === 'url';
        var built;
        if (useUrl) {
            if (!config.endpoint) {
                return this._fail('A request URL is required for a direct URL call.');
            }
            built = { endpoint: String(config.endpoint), httpMethod: String(config.httpMethod || 'get') };
        } else {
            if (!config.restMessage || !config.method) {
                return this._fail('restMessage and method are required.');
            }
            // Resolve the function's endpoint/method ourselves instead of calling
            // new RESTMessageV2(name, method). A scoped app cannot instantiate a REST
            // Message that lives in another scope (e.g. Global) by name -- the constructor
            // throws "Unable to find REST Message Record with Name". Rebuilding from the
            // stored endpoint makes the explorer work against messages in ANY scope.
            built = this._resolveFunction(config.restMessage, config.method);
            if (built.error) {
                return this._fail(built.error);
            }
        }

        var useMid = !!config.midServer;

        var sm;
        try {
            // Always build a transient message from a raw endpoint (see above); the
            // named-record constructor is never used, so cross-scope messages work too.
            sm = new sn_ws.RESTMessageV2();
            sm.setEndpoint(built.endpoint);
            sm.setHttpMethod(built.httpMethod || 'get');
            // Reproduce the saved function's own headers / query params so the request
            // matches the stored message before the user's overrides are layered on.
            this._applyFunctionDefaults(sm, built, config.variables);
        } catch (e) {
            return this._fail('Could not build request for "' + built.endpoint + '": ' + e);
        }

        // Fall back to the function's stored request body when the user left it blank.
        if (built.content && (config.body == null || config.body === '')) {
            config.body = built.content;
        }

        // --- Authentication -------------------------------------------------
        // Any failure here is returned to the caller; we never fire the request
        // with a half-applied or missing credential.
        var authError = this._applyAuth(sm, config, useMid, built.endpoint, built.messageSysId);
        if (authError) {
            return this._fail(authError);
        }

        // --- Variables, headers, body --------------------------------------
        this._applyParameters(sm, config, { useUrl: useUrl, endpoint: built.endpoint });

        // --- Route + execute -----------------------------------------------
        if (useMid) {
            sm.setMIDServer(config.midServer);
        }

        try {
            var response;
            if (useMid) {
                // MID-routed messages are always asynchronous.
                response = sm.executeAsync();
                response.waitForResponse(this._timeoutSeconds(config.timeout));
            } else {
                response = sm.execute();
            }
            return this._normalize(response);
        } catch (e) {
            return this._fail('Request execution failed: ' + e, sm);
        }
    },

    /**
     * Apply authentication to the message. Returns an error string on failure,
     * or null/undefined on success.
     */
    _applyAuth: function(sm, config, useMid, endpoint, messageSysId) {
        switch (config.authType) {

            case 'basic':
                var basic = config.basic || {};
                if (basic.mode === 'manual') {
                    if (!basic.username) {
                        return 'Basic auth (manual) selected but no username was provided.';
                    }
                    sm.setBasicAuth(String(basic.username), String(basic.password == null ? '' : basic.password));
                    return null;
                }
                if (!config.authProfile) {
                    return 'Basic auth selected but no Basic Auth profile was chosen.';
                }
                sm.setAuthenticationProfile('basic', config.authProfile);
                return null;

            case 'apikey':
                var key = config.apiKey || {};
                if (!key.name || key.value == null) {
                    return 'API key auth selected but the key name/value is missing.';
                }
                if (key.placement === 'query') {
                    // Substitute only when a ${name} token actually exists in the endpoint
                    // or body; otherwise append a real query parameter. Substitution alone
                    // (setStringParameterNoEscape) would silently drop the key when no token
                    // is present and the request would fire unauthenticated.
                    if (this._hasToken(endpoint, key.name) || this._hasToken(config.body, key.name)) {
                        sm.setStringParameterNoEscape(key.name, String(key.value));
                    } else {
                        sm.setQueryParameter(key.name, String(key.value));
                    }
                } else {
                    sm.setRequestHeader(key.name, String(key.value));
                }
                return null;

            case 'oauth':
                // The MID-server OAuth workaround: fetch the token in script, inject it
                // as a literal Bearer header, and set the profile to no_authentication so
                // the platform does not re-authenticate over the manual header. This is the
                // only path that works when routing an OAuth-secured call through a MID server.
                var token = this._getAccessToken(config, useMid, messageSysId);
                if (token.error) {
                    return token.error;
                }
                sm.setRequestHeader('Authorization', 'Bearer ' + token.value);
                // NOTE: 'no_authentication' is an undocumented value for setAuthenticationProfile
                // (docs list only 'basic' and 'oauth2'). Verified working in production; keep an
                // eye on this if a platform upgrade changes REST auth behavior.
                sm.setAuthenticationProfile('no_authentication');
                return null;

            case 'none':
            case undefined:
            case null:
            case '':
                return null;

            default:
                return 'Unknown authentication type: ' + config.authType;
        }
    },

    /**
     * Fetch an OAuth access token, refreshing through the MID server when the call
     * is MID-routed (the token endpoint is usually behind the same firewall).
     *
     * Stored tokens are keyed by (requestor, profile), and different platform flows
     * store them under different requestors: "Get OAuth Token" on a REST message uses
     * the message record, the credential page uses the credential record. So this
     * searches all plausible requestors before minting -- an authorization-code
     * profile (e.g. GitHub) CANNOT mint headlessly and reuse is the only option.
     * Returns { value } on success or { error } on failure -- never a silent undefined.
     */
    _getAccessToken: function(config, useMid, messageSysId) {
        if (!config.authProfile) {
            return { error: 'OAuth selected but no OAuth Entity Profile was chosen.' };
        }
        try {
            var oAuthClient = new sn_auth.GlideOAuthClient();

            var found = this._findStoredToken(oAuthClient, config, messageSysId);
            if (found.fresh) {
                return { value: found.fresh.getAccessToken() };
            }

            // No fresh stored token: try to mint (or refresh) one. Target the requestor
            // a stored-but-expiring token was found under, so a refresh grant hits the
            // right credential.
            var tokenRequest = new sn_auth.GlideOAuthClientRequest();
            tokenRequest.setParameter('oauth_requestor_context', 'rest');
            var requestor = config.requestorId || (found.stale ? found.stale.requestor : '');
            if (requestor) {
                tokenRequest.setParameter('oauth_requestor', requestor);
            }
            tokenRequest.setParameter('oauth_provider_profile', config.authProfile);
            if (useMid) {
                tokenRequest.setMIDServer(config.midServer);
            }
            var tokenResponse = oAuthClient.requestTokenByRequest(null, tokenRequest);
            var token = tokenResponse ? tokenResponse.getToken() : null;
            if (token && token.getAccessToken()) {
                return { value: token.getAccessToken() };
            }

            // The mint failed. A stored token past its refresh threshold beats nothing:
            // the provider may still honor it (some, like GitHub, outlive their recorded
            // expiry), and if not the 401 shows up plainly in the console.
            if (found.stale) {
                gs.warn('Outbound REST Console: OAuth token refresh failed (' +
                    (this._tokenFailureDetail(tokenResponse) || 'no provider detail') +
                    '); reusing the stored token, which may be expired.');
                return { value: found.stale.token.getAccessToken() };
            }

            var detail = this._tokenFailureDetail(tokenResponse);
            return { error: 'OAuth token request returned no access token.' +
                (detail ? ' Provider response: ' + detail + '.' : '') +
                ' Check the OAuth profile and (for MID routing) the MID server.' +
                ' If the profile uses the authorization_code grant, first mint a token' +
                ' interactively ("Get OAuth Token" on the REST message, or the OAuth' +
                ' credential page) -- the console will then reuse it.' };
        } catch (e) {
            return { error: 'OAuth token request failed: ' + e };
        }
    },

    /**
     * Search the stored tokens for this profile across every plausible requestor:
     * the explicit requestorId, the source REST message record, any requestor
     * profiles registered against the OAuth profile, and the blank default.
     * Returns { fresh, stale } -- fresh is a token with >= TOKEN_MIN_TTL left;
     * stale is { token, requestor } for the best short-lived match found.
     */
    _findStoredToken: function(oAuthClient, config, messageSysId) {
        var candidates = [];
        if (config.requestorId) {
            candidates.push(String(config.requestorId));
        }
        if (messageSysId) {
            candidates.push(String(messageSysId));
        }
        var stored = this._requestorCandidates(config.authProfile);
        for (var i = 0; i < stored.length; i++) {
            // getToken's documented arg is the requestor-profile sys_id, but requestor
            // sys_ids are seen in the wild too -- try both, cheap either way.
            candidates.push(stored[i].requestorProfileId);
            if (stored[i].requestor) {
                candidates.push(stored[i].requestor);
            }
        }
        candidates.push('');

        var seen = {};
        var stale = null;
        for (var j = 0; j < candidates.length; j++) {
            var id = candidates[j];
            if (seen.hasOwnProperty(id)) {
                continue;
            }
            seen[id] = true;
            var token = null;
            try {
                token = oAuthClient.getToken(id, config.authProfile);
            } catch (e) { /* a bad candidate must not abort the search */ }
            if (token && token.getAccessToken()) {
                if (token.getExpiresIn() >= this.TOKEN_MIN_TTL) {
                    return { fresh: token, stale: stale };
                }
                if (!stale) {
                    stale = { token: token, requestor: id };
                }
            }
        }
        return { fresh: null, stale: stale };
    },

    /**
     * Requestor profiles registered against an OAuth entity profile. Best-effort:
     * oauth_requestor_profile is not in the verified schema set, and ACLs may hide
     * it from this scope -- either way this just contributes no candidates.
     */
    _requestorCandidates: function(profileId) {
        var out = [];
        try {
            var gr = new GlideRecord('oauth_requestor_profile');
            if (!gr.isValid()) {
                return out;
            }
            gr.addQuery('oauth_entity_profile', profileId);
            gr.query();
            while (gr.next()) {
                // Re-check the value: on some releases addQuery silently ignores an
                // unknown column and would hand back every requestor profile row.
                if (gr.getValue('oauth_entity_profile') !== String(profileId)) {
                    continue;
                }
                out.push({
                    requestorProfileId: gr.getUniqueValue(),
                    requestor: gr.getValue('oauth_requestor')
                });
            }
        } catch (e) { /* fail soft: no candidates from this source */ }
        return out;
    },

    /**
     * Summarize why a token mint failed, from the GlideOAuthClientResponse.
     * Each accessor is guarded: the response object may be absent or partial.
     */
    _tokenFailureDetail: function(tokenResponse) {
        if (!tokenResponse) {
            return '';
        }
        var parts = [];
        var read = function(method) {
            try {
                if (typeof tokenResponse[method] === 'function') {
                    var v = tokenResponse[method]();
                    return v == null ? '' : String(v);
                }
            } catch (e) { /* diagnostic only -- never mask the real error */ }
            return '';
        };
        var code = read('getResponseCode');
        if (code) {
            parts.push('HTTP ' + code);
        }
        var message = read('getErrorMessage');
        if (message) {
            parts.push(message);
        }
        var body = read('getBody');
        if (body) {
            parts.push(body.length > 500 ? body.substring(0, 500) + '…' : body);
        }
        return parts.join(' — ');
    },

    _applyParameters: function(sm, config, options) {
        options = options || {};
        var endpoint = options.endpoint || '';
        var name;
        if (config.variables) {
            for (name in config.variables) {
                if (config.variables.hasOwnProperty(name)) {
                    var value = String(config.variables[name]);
                    // A variable substitutes wherever ${name} appears (endpoint or body).
                    // In Direct URL mode a variable with no matching ${name} token is instead
                    // appended as a query parameter, so plain key/value pairs land on the
                    // query string. The token check keeps a templated variable from being
                    // both substituted and duplicated onto the query string.
                    if (options.useUrl && !this._hasToken(endpoint, name) && !this._hasToken(config.body, name)) {
                        sm.setQueryParameter(name, value);
                    } else {
                        // NoEscape: do not XML-escape values (faithful substitution).
                        sm.setStringParameterNoEscape(name, value);
                    }
                }
            }
        }
        if (config.headers) {
            for (name in config.headers) {
                if (config.headers.hasOwnProperty(name)) {
                    sm.setRequestHeader(name, String(config.headers[name]));
                }
            }
        }
        if (config.body != null && config.body !== '') {
            sm.setRequestBody(String(config.body));
        }
    },

    /**
     * Resolve a REST Message function to the pieces needed to rebuild it as a transient
     * message: endpoint, HTTP method, default body, static headers and query parameters.
     * Read with GlideRecord (works cross-scope) rather than the RESTMessageV2 constructor.
     * Returns { error } on failure -- never a silent undefined.
     */
    _resolveFunction: function(restMessageName, functionName) {
        var parent = this._getRestMessage(restMessageName);
        if (!parent) {
            return { error: 'REST Message "' + restMessageName + '" was not found.' };
        }
        var fn = new GlideRecord('sys_rest_message_fn');
        fn.addQuery('rest_message', parent.getUniqueValue());
        fn.addQuery('function_name', functionName);
        fn.query();
        if (!fn.next()) {
            return { error: 'Method "' + functionName + '" was not found on REST Message "' + restMessageName + '".' };
        }
        var endpoint = fn.getValue('rest_endpoint') || parent.getValue('rest_endpoint');
        if (!endpoint) {
            return { error: 'No endpoint is configured on "' + restMessageName + ' / ' + functionName + '".' };
        }
        var fnId = fn.getUniqueValue();
        return {
            // The parent message sys_id doubles as the OAuth requestor: a token minted
            // via "Get OAuth Token" on the REST message record is stored against it.
            messageSysId: parent.getUniqueValue(),
            endpoint: endpoint,
            httpMethod: fn.getValue('http_method') || 'get',
            content: fn.getValue('content') || '',
            headers: this._readFnChildValues('sys_rest_message_fn_headers', fnId),
            // Defined HTTP query parameters. ServiceNow does not enforce this table --
            // functions may instead template query params straight into the endpoint
            // (?limit=${limit}) and rely on variable substitutions
            // (sys_rest_message_fn_parameters). Both patterns work here: these rows are
            // re-applied via setQueryParameter and ${token}s substitute independently.
            queryParams: this._readFnChildValues('sys_rest_message_fn_param_defs', fnId)
        };
    },

    /**
     * Look up a sys_rest_message by sys_id (preferred -- names are not unique across
     * scopes, so a name lookup can silently pick the wrong record) with a name
     * fallback for hand-written callers. Returns the GlideRecord or null.
     */
    _getRestMessage: function(idOrName) {
        var gr = new GlideRecord('sys_rest_message');
        if (gr.get(idOrName)) {
            return gr;
        }
        gr = new GlideRecord('sys_rest_message');
        if (gr.get('name', idOrName)) {
            return gr;
        }
        return null;
    },

    /** True when text contains a ${name} substitution token. */
    _hasToken: function(text, name) {
        return !!text && String(text).indexOf('${' + name + '}') !== -1;
    },

    /** Positive integer seconds for waitForResponse; anything else falls back to 60. */
    _timeoutSeconds: function(value) {
        var t = parseInt(value, 10);
        return t > 0 ? t : 60;
    },

    /** Read a function's child name/value rows (headers or query params). */
    _readFnChildValues: function(table, fnId) {
        var out = [];
        var gr = new GlideRecord(table);
        if (!gr.isValid()) {
            return out; // Table not present on this instance -- fail soft.
        }
        gr.addQuery('rest_message_function', fnId);
        gr.orderBy('order'); // param_defs rows carry an order column; harmless where absent
        gr.query();
        while (gr.next()) {
            out.push({ name: gr.getValue('name'), value: gr.getValue('value') });
        }
        return out;
    },

    /**
     * Map a stored REST Message function's configured authentication to the widget's
     * auth model ({ type, mode, profile, username }), so the UI can preselect the auth
     * dropdown + profile when a method is chosen. Pure: reads only .getValue() off the
     * two GlideRecords, so it is unit-testable without an instance.
     *
     * The function's own authentication_type wins unless it is 'inherit_from_parent'
     * (its default), in which case the parent sys_rest_message's config applies -- and
     * the profile fields are read from whichever record supplied the type.
     *
     * This is a UI suggestion only; execute() never consults it -- the user's explicit
     * selection drives the outbound call, and OAuth still runs the manual-token path.
     */
    _mapStoredAuth: function(parent, fn) {
        var type = fn.getValue('authentication_type');
        var src = fn; // the record whose profile fields apply
        if (!type || type === 'inherit_from_parent') {
            type = parent.getValue('authentication_type');
            src = parent;
        }
        switch (type) {
            case 'basic':
            case 'basic_simple':
                var basicProfile = src.getValue('basic_auth_profile') || '';
                return {
                    type: 'basic',
                    // A configured Basic Auth profile preselects the profile picker;
                    // otherwise fall back to the inline username (manual mode -- there
                    // is no stored password to prefill).
                    mode: basicProfile ? 'profile' : 'manual',
                    profile: basicProfile,
                    username: src.getValue('basic_auth_user') || ''
                };
            case 'oauth2':
                return { type: 'oauth', mode: 'profile', profile: src.getValue('oauth2_profile') || '', username: '' };
            case 'no_authentication':
            default:
                // no_authentication, mutual auth, or anything unrecognized: no preselection.
                return { type: 'none', mode: 'profile', profile: '', username: '' };
        }
    },

    /**
     * Apply the saved function's static headers and query parameters to the message.
     * A defined header/query-param VALUE may itself be a ${token} template resolved by
     * variable substitutions (e.g. the query param s=${symbol}); resolve the tokens we
     * have variable values for ourselves, so the outcome does not depend on whether the
     * platform substitutes into setQueryParameter/setRequestHeader values on a rebuilt
     * transient message. Unresolved tokens are left intact for the platform to try.
     */
    _applyFunctionDefaults: function(sm, built, variables) {
        var headers = built.headers || [];
        for (var i = 0; i < headers.length; i++) {
            if (headers[i].name) {
                var hv = String(headers[i].value == null ? '' : headers[i].value);
                sm.setRequestHeader(headers[i].name, this._substituteTokens(hv, variables));
            }
        }
        var params = built.queryParams || [];
        for (var j = 0; j < params.length; j++) {
            if (params[j].name) {
                var pv = String(params[j].value == null ? '' : params[j].value);
                sm.setQueryParameter(params[j].name, this._substituteTokens(pv, variables));
            }
        }
    },

    /** Replace ${name} tokens that have a value in variables; leave the rest intact. */
    _substituteTokens: function(text, variables) {
        if (!variables || String(text).indexOf('${') === -1) {
            return text;
        }
        return String(text).replace(/\$\{([^}]+)\}/g, function(match, name) {
            return Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match;
        });
    },

    /** Turn a RESTResponseV2 into the flat shape the widget renders. */
    _normalize: function(response) {
        if (response.haveError()) {
            return {
                ok: false,
                status: response.getStatusCode(),
                headers: this._headersToObject(response),
                body: response.getBody(),
                error: response.getErrorCode() + ': ' + response.getErrorMessage()
            };
        }
        return {
            ok: true,
            status: response.getStatusCode(),
            headers: this._headersToObject(response),
            body: response.getBody(),
            error: null
        };
    },

    _headersToObject: function(response) {
        // getHeaders() returns a name->value Object; copy it into a plain object so it
        // serializes cleanly across the widget boundary. No hasOwnProperty filter: the
        // object is a wrapped Java map under Rhino, whose keys are not "own" properties.
        var out = {};
        var any = false;
        try {
            var headers = response.getHeaders();
            for (var k in headers) {
                out[k] = String(headers[k]);
                any = true;
            }
        } catch (e) {
            // Non-fatal: fall through to getAllHeaders() below.
        }
        if (!any) {
            // The wrapped map may not enumerate at all; getAllHeaders() returns a list
            // of header objects instead. Handle both Java List and array shapes.
            try {
                var list = response.getAllHeaders();
                var n = typeof list.size === 'function' ? list.size() : list.length;
                for (var i = 0; i < n; i++) {
                    var h = typeof list.get === 'function' ? list.get(i) : list[i];
                    var hName = typeof h.getName === 'function' ? h.getName() : h.name;
                    var hValue = typeof h.getValue === 'function' ? h.getValue() : h.value;
                    out[String(hName)] = String(hValue);
                }
            } catch (e2) {
                // Non-fatal: a missing header map should not sink a good response.
            }
        }
        return out;
    },

    _fail: function(message, sm) {
        var result = { ok: false, status: null, headers: {}, body: null, error: message };
        if (sm) {
            try {
                result.requestBody = sm.getRequestBody();
            } catch (e) {}
        }
        gs.warn('RestExplorerEngine: ' + message);
        return result;
    },

    type: 'RestExplorerEngine'
};
