api.controller = function($scope, $window, $timeout) {
    /* global angular */
    var c = this;

    // Response-panel view state: which sections are collapsed (keyed by section name,
    // so a new response resets them all with one assignment), and which section was
    // last copied (drives the transient "Copied" checkmark on the copy buttons).
    c.ui = { collapsed: {}, copied: '' };

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
        queryParamsList: [],
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

    // ---- Surviving the "Get OAuth Token" page reload ---------------------
    // The OAuth authorization-code flow opens the platform's oauth_initiator.do in a
    // popup; its provider callback (oauth_redirect.do) reloads this opener window once
    // the token is stored -- native platform behavior we cannot suppress from the popup.
    // That reload would otherwise drop the user back to a blank widget, losing the URL /
    // message / auth selections they just set up. So we snapshot the request into
    // sessionStorage right before opening the popup and restore it on the next init.
    var STATE_KEY = 'x_1676196_rest_gui.req';
    var STATE_TTL_MS = 30 * 60 * 1000; // ignore a stale snapshot from an old session

    function _saveState() {
        try {
            // Drop secrets from the snapshot: sessionStorage is same-origin and cleared
            // on tab close, but there is no reason to persist a password/API key across a
            // reload (the OAuth flow that triggers the save does not use them anyway).
            var snapshot = angular.copy(c.req);
            if (snapshot.basic) { snapshot.basic.password = ''; }
            if (snapshot.apiKey) { snapshot.apiKey.value = ''; }
            $window.sessionStorage.setItem(STATE_KEY, JSON.stringify({ ts: Date.now(), req: snapshot }));
        } catch (e) { /* storage unavailable -- state just won't survive the reload */ }
    }

    function _clearState() {
        try { $window.sessionStorage.removeItem(STATE_KEY); } catch (e) { /* nothing to clear */ }
    }

    (function _restoreState() {
        var saved;
        try {
            var raw = $window.sessionStorage.getItem(STATE_KEY);
            if (!raw) { return; }
            $window.sessionStorage.removeItem(STATE_KEY); // one-shot: consume it
            saved = JSON.parse(raw);
        } catch (e) { return; }
        if (!saved || !saved.ts || (Date.now() - saved.ts) > STATE_TTL_MS || !saved.req) { return; }
        angular.extend(c.req, saved.req);
        // The Method dropdown's options (c.methods) are not part of c.req; reload them so
        // the restored method shows its label instead of a blank "unknown option" entry.
        // Deferred so the SP server proxy is fully wired before the call.
        if (c.req.source === 'restMessage' && c.req.restMessage) {
            $timeout(function() { _fetchMethods(c.req.restMessage); });
        }
    })();

    // ---- Key/value row helpers -------------------------------------------
    c.addRow = function(list) { list.push({ k: '', v: '' }); };
    c.removeRow = function(list, i) { list.splice(i, 1); };

    // ---- Direct URL parsing ----------------------------------------------
    // When the user types or pastes a URL with a query string, extract the params
    // into the Query Params section and strip them from the URL field. Existing
    // manual params are kept; params already present are updated by key.
    c.parseUrl = function() {
        if (c.req.source !== 'url' || !c.req.endpoint) { return; }
        var parsed = _parseUrl(c.req.endpoint);
        if (!parsed) { return; }
        c.req.endpoint = parsed.url;
        _mergeQueryParams(c.req.queryParamsList, parsed.params);
    };

    function _parseUrl(url) {
        try {
            var u = new URL(url);
            var params = [];
            u.searchParams.forEach(function(value, name) {
                params.push({ k: name, v: value });
            });
            u.search = '';
            return { url: u.toString(), params: params };
        } catch (e) {
            return null;
        }
    }

    function _mergeQueryParams(list, newParams) {
        newParams.forEach(function(p) {
            var found = false;
            for (var i = 0; i < list.length; i++) {
                if (list[i].k === p.k) {
                    list[i].v = p.v;
                    found = true;
                    break;
                }
            }
            if (!found) {
                list.push(p);
            }
        });
    }

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
        _fetchMethods(c.req.restMessage);
    };

    // Shared by loadMethods and the post-OAuth state restore (which must not go
    // through loadMethods itself -- that would clear the just-restored selection).
    function _fetchMethods(restMessage) {
        return c.server.get({ action: 'getMethods', restMessage: restMessage }).then(function(r) {
            c.methods = r.data.methods || [];
        });
    }

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
    c.getOAuthToken = function($event) {
        if ($event) { $event.preventDefault(); }
        if (!c.req.authProfile) { return; }
        // Preserve the current request: the popup's provider callback reloads this page,
        // and _restoreState() rehydrates it on the way back in.
        _saveState();
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
        var popup = $window.open('/oauth_initiator.do?' + query, 'rest_gui_oauth_popup', 'width=800,height=700');
        if (!popup) {
            // Popup blocked: no provider callback will ever reload this page, so the
            // snapshot would hijack the next unrelated init. Discard it now.
            _clearState();
            return;
        }
        // Same problem if the user closes the popup without completing the flow: watch
        // for the close and discard the snapshot after a short grace period. On success
        // the callback reloads this window, killing these timers before the clear runs
        // (the grace covers a reload that starts just after the popup closes). Plain
        // timers, not $timeout: nothing here touches the model.
        var watch = $window.setInterval(function() {
            if (popup.closed) {
                $window.clearInterval(watch);
                $window.setTimeout(_clearState, 5000);
            }
        }, 1000);
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
            queryParams: _pairsToObject(c.req.queryParamsList),
            headers: _pairsToObject(c.req.headersList),
            body: c.req.body
        };

        // Use a transient input so the initial-load branch of the server script
        // does not re-run; c.server.get sends `input` without persisting widget state.
        c.server.get({ action: 'execute', config: config }).then(function(r) {
            c.loading = false;
            c.resp = r.data.result;
            c.prettyUrl = _prettyUrl(c.resp);
            c.prettyBody = _prettyPrint(c.resp);
            c.prettyHeaders = _prettyHeaders(c.resp);
            c.ui.collapsed = {};
        }, function() {
            c.loading = false;
            c.resp = { ok: false, status: null, error: 'Client-server call failed.', headers: {}, body: null };
            c.prettyUrl = '';
            c.prettyBody = _prettyPrint(c.resp);
            c.prettyHeaders = _prettyHeaders(c.resp);
            c.ui.collapsed = {};
        });
    };

    // ---- Copy a section's text to the clipboard --------------------------
    // `what` names the section ('headers' | 'body') so the button can flash a
    // transient "Copied" acknowledgement. Uses the async Clipboard API where the
    // browser exposes it, falling back to a hidden-textarea execCommand copy.
    c.copy = function(text, what) {
        var value = text == null ? '' : String(text);
        var done = function() {
            // done() may run as a native-promise microtask, outside Angular's digest;
            // route the model change through $timeout so the checkmark always renders.
            $timeout(function() {
                c.ui.copied = what;
                $timeout(function() {
                    if (c.ui.copied === what) { c.ui.copied = ''; }
                }, 1500);
            });
        };
        var nav = $window.navigator;
        if (nav && nav.clipboard && nav.clipboard.writeText) {
            nav.clipboard.writeText(value).then(done, function() { _fallbackCopy(value, done); });
        } else {
            _fallbackCopy(value, done);
        }
    };

    function _fallbackCopy(value, done) {
        try {
            var doc = $window.document;
            var ta = doc.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            doc.body.appendChild(ta);
            ta.focus();
            ta.select();
            var ok = doc.execCommand('copy');
            doc.body.removeChild(ta);
            // execCommand reports failure via its return value, not an exception;
            // only acknowledge when the text actually reached the clipboard.
            if (ok) { done(); }
        } catch (e) {
            // Clipboard unavailable (permissions/older browser) -- fail quietly rather
            // than throwing; the user can still select the text manually.
        }
    }

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

    // The actual URL sent, as returned by the engine. The server reads this from the
    // RESTMessageV2 after query parameters are applied, so it reflects the real request
    // (not the client's earlier live approximation).
    function _prettyUrl(resp) {
        return resp && resp.url ? String(resp.url) : '';
    }

    // Pretty-print the response headers as JSON text. Kept as a real string (rather
    // than the `| json` filter) so the copy button has an exact value to hand off.
    // headers is always a plain object of string values (built server-side and JSON
    // round-tripped), so stringify cannot throw.
    function _prettyHeaders(resp) {
        return resp && resp.headers ? JSON.stringify(resp.headers, null, 2) : '';
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
