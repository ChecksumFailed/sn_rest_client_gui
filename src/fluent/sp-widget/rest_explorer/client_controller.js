api.controller = function($scope, $window) {
    /* global angular */
    var c = this;

    c.req = {
        source: 'restMessage',            // 'restMessage' | 'url'
        restMessage: '',                  // sys_rest_message sys_id
        method: '',
        endpoint: '',                     // direct-URL mode
        httpMethod: 'get',                // direct-URL mode verb
        authType: 'none',
        authProfile: '',
        basic: { mode: 'profile', username: '', password: '' },
        requestorId: '',
        midServer: '',
        timeout: 60,                      // seconds to wait for a MID (async) response
        apiKey: { placement: 'header', name: '', value: '' },
        variablesList: [],
        headersList: [],
        body: ''
    };
    // Preselect the suggested MID server only when it is actually in the Up list;
    // assigning a value that is not among the options would leave the select on a
    // blank "unknown option" entry.
    (c.data.midServers || []).some(function(s) {
        if (s.value === c.data.suggestedMid) { c.req.midServer = s.value; return true; }
        return false;
    });
    c.methods = [];
    c.httpVerbs = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
    c.resp = null;
    c.loading = false;

    // ---- Key/value row helpers -------------------------------------------
    c.addRow = function(list) { list.push({ k: '', v: '' }); };
    c.removeRow = function(list, i) { list.splice(i, 1); };

    // ---- Switching request source (REST message vs raw URL) --------------
    c.onSourceChange = function() {
        // Variables auto-populated from a function no longer apply once we leave
        // REST-message mode; clear them so a stale set isn't sent with a URL call.
        // Coming back with a method still selected, reload them so the request is
        // not silently missing its substitutions.
        if (c.req.source !== 'restMessage') {
            c.req.variablesList = [];
        } else if (c.req.method) {
            c.loadVariables();
        }
    };

    // ---- Load HTTP methods for the selected REST message ------------------
    c.loadMethods = function() {
        c.req.method = '';
        c.methods = [];
        c.req.variablesList = [];
        if (!c.req.restMessage) { return; }
        c.server.get({ action: 'getMethods', restMessage: c.req.restMessage }).then(function(r) {
            c.methods = r.data.methods || [];
        });
    };

    // ---- React to a method selection -------------------------------------
    // Preselect the stored auth for this method, then load its variables.
    c.onMethodChange = function() {
        c.applyMethodAuth();
        c.loadVariables();
    };

    // ---- Preselect the auth dropdown + profile from the stored function ----
    // The method carries its resolved auth (function's own, or the parent's when it
    // inherits). This is a starting point only -- the user can still change it.
    c.applyMethodAuth = function() {
        var m = _findMethod(c.req.method);
        var auth = m && m.auth;
        if (!auth) { return; }
        c.req.authType = auth.type || 'none';
        if (auth.type === 'basic') {
            c.req.basic.mode = auth.mode || 'profile';
            c.req.basic.username = auth.username || '';
            c.req.authProfile = auth.profile || '';
        } else if (auth.type === 'oauth') {
            c.req.authProfile = auth.profile || '';
        } else {
            c.req.authProfile = '';
        }
    };

    function _findMethod(value) {
        for (var i = 0; i < c.methods.length; i++) {
            if (c.methods[i].value === value) { return c.methods[i]; }
        }
        return null;
    }

    // ---- Load variable substitutions for the selected function -----------
    // One editable row per ${variable} defined on the function, pre-filled with
    // its stored default value. The user can still add/remove rows afterward.
    c.loadVariables = function() {
        c.req.variablesList = [];
        if (!c.req.restMessage || !c.req.method) { return; }
        c.server.get({
            action: 'getVariables',
            restMessage: c.req.restMessage,
            method: c.req.method
        }).then(function(r) {
            c.req.variablesList = (r.data.variables || []).map(function(v) {
                return { k: v.name, v: v.value };
            });
        });
    };

    // ---- Mint an OAuth token interactively (authorization-code flow) ------
    // Opens the platform's own token-initiation page -- the same one the
    // "Get OAuth Token" UI action on a REST message uses. The provider redirect
    // back to oauth_redirect.do stores the token; the engine's stored-token
    // search finds it on the next Send. The requestor mirrors the native flow:
    // the selected REST message record when there is one, else the profile
    // itself (the engine searches every requestor registered on the profile,
    // so either way the token is found).
    c.getOAuthToken = function() {
        if (!c.req.authProfile) { return; }
        var onMessage = c.req.source === 'restMessage' && c.req.restMessage;
        var params = {
            oauth_requestor_context: onMessage ? 'rest_message' : 'rest',
            oauth_requestor: onMessage ? c.req.restMessage : c.req.authProfile,
            oauth_provider_profile: c.req.authProfile,
            response_type: 'code'
        };
        var query = Object.keys(params).map(function(k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        $window.open('/oauth_initiator.do?' + query, 'rest_gui_oauth_popup', 'width=800,height=700');
    };

    // ---- Whether Send is allowed for the current source ------------------
    c.canSend = function() {
        return c.req.source === 'url' ? !!c.req.endpoint : !!c.req.method;
    };

    // ---- Beautify the request body if it is JSON -------------------------
    c.beautify = function() {
        try {
            c.req.body = JSON.stringify(JSON.parse(c.req.body), null, 2);
        } catch (e) {
            // Not JSON -- leave the body untouched rather than corrupting it.
        }
    };

    // ---- Send -------------------------------------------------------------
    c.send = function() {
        c.loading = true;
        c.resp = null;

        var config = {
            source: c.req.source,
            restMessage: c.req.restMessage,
            method: c.req.method,
            endpoint: c.req.endpoint,
            httpMethod: c.req.httpMethod,
            authType: c.req.authType,
            authProfile: c.req.authProfile,
            basic: c.req.basic,
            requestorId: c.req.requestorId,
            midServer: c.req.midServer,
            timeout: c.req.timeout,
            apiKey: c.req.apiKey,
            variables: _pairsToObject(c.req.variablesList),
            headers: _pairsToObject(c.req.headersList),
            body: c.req.body
        };

        // Use a transient input so the initial-load branch of the server script
        // does not re-run; c.server.get sends `input` without persisting widget state.
        c.server.get({ action: 'execute', config: config }).then(function(r) {
            c.loading = false;
            c.resp = r.data.result;
            c.prettyBody = _prettyPrint(c.resp);
        }, function() {
            c.loading = false;
            c.resp = { ok: false, status: null, error: 'Client-server call failed.', headers: {}, body: null };
            c.prettyBody = '';
        });
    };

    function _pairsToObject(list) {
        var obj = {};
        (list || []).forEach(function(kv) {
            if (kv.k) { obj[kv.k] = kv.v; }
        });
        return obj;
    }

    // Pretty-print the response body when it is JSON (by Content-Type or shape);
    // anything else is shown as raw text. The result is rendered with a plain
    // {{ }} text binding, so no HTML handling or sanitization is involved. Kept
    // dependency-free (no CodeMirror/Prism) so the widget needs no library wiring.
    function _prettyPrint(resp) {
        if (!resp || resp.body == null) { return ''; }
        var body = String(resp.body);
        var ct = _headerValue(resp.headers, 'content-type');

        if (ct.indexOf('json') !== -1 || _looksJson(body)) {
            try {
                body = JSON.stringify(JSON.parse(body), null, 2);
            } catch (e) { /* fall through, show raw */ }
        }
        return body;
    }

    function _headerValue(headers, name) {
        if (!headers) { return ''; }
        var lower = name.toLowerCase();
        for (var k in headers) {
            if (headers.hasOwnProperty(k) && k.toLowerCase() === lower) {
                return String(headers[k]).toLowerCase();
            }
        }
        return '';
    }

    function _looksJson(s) {
        var t = s.replace(/^\s+/, '');
        return t.charAt(0) === '{' || t.charAt(0) === '[';
    }
};
