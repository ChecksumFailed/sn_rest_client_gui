(function() {
    /* global $sp, gs, GlideRecord, RestExplorerEngine, sn_auth, data, input, options */

    data.canRun = gs.hasRole(RestExplorerEngine.prototype.EXPLORER_ROLE) || gs.hasRole('admin');
    if (!data.canRun) {
        data.deniedRole = RestExplorerEngine.prototype.EXPLORER_ROLE;
        return; // Do not leak record lists or run anything for users without the role.
    }

    // Base dropdown data is needed only on the initial render (no input). c.server.get()
    // resolves its response to the caller's promise WITHOUT touching the widget's c.data
    // (only c.server.update() replaces it), and the client reads just the action-specific
    // fields (methods / variables / result) off action responses -- so action calls can
    // skip these queries entirely.
    if (!input) {
        // REST messages are keyed by sys_id: names are not unique across scopes, so a
        // name lookup could silently resolve to a different scope's message.
        data.restMessages = _readChoices('sys_rest_message', 'name', 'sys_id', null);
        data.oauthProfiles = _readChoices('oauth_entity_profile', 'name', 'sys_id', null);
        data.basicProfiles = _readChoices('sys_auth_profile_basic', 'name', 'sys_id', null);
        data.midServers = _readChoices('ecc_agent', 'name', 'name', 'status=Up');

        // Suggested MID server. OAuthMidSelector is undocumented, so wrap defensively;
        // on any failure the dropdown simply has no preselection and the user picks.
        data.suggestedMid = '';
        try {
            var suggestion = new sn_auth.OAuthMidSelector().selectRESTCapableMidServer('all', null);
            if (suggestion) {
                data.suggestedMid = String(suggestion);
            }
        } catch (e) {
            data.suggestedMid = gs.getProperty(RestExplorerEngine.prototype.DEFAULT_MID_PROPERTY, '');
        }
    }

    // ---- Actions (additive on top of the base data above) -----------------
    if (input && input.action === 'execute') {
        var engine = new RestExplorerEngine();
        data.result = engine.execute(input.config || {});

    } else if (input && input.action === 'getMethods' && input.restMessage) {
        data.methods = _readMethods(input.restMessage);

    } else if (input && input.action === 'getVariables' && input.restMessage && input.method) {
        data.variables = _readVariables(input.restMessage, input.method);
    }

    /**
     * Read a table into [{label, value}] choices.
     */
    function _readChoices(table, labelField, valueField, encodedQuery) {
        var out = [];
        var gr = new GlideRecord(table);
        if (!gr.isValid()) {
            return out; // Table not present on this instance -- fail soft.
        }
        if (encodedQuery) {
            gr.addEncodedQuery(encodedQuery);
        }
        gr.orderBy(labelField);
        gr.query();
        while (gr.next()) {
            out.push({
                label: gr.getValue(labelField),
                value: gr.getValue(valueField)
            });
        }
        return out;
    }

    /**
     * HTTP methods (sys_rest_message_fn) for the named REST message. Loaded on demand
     * rather than eagerly, since they depend on the selected message.
     */
    function _readMethods(restMessageId) {
        var methods = [];
        var engine = new RestExplorerEngine();
        var parent = engine._getRestMessage(restMessageId);
        if (!parent) {
            return methods;
        }
        var fn = new GlideRecord('sys_rest_message_fn');
        fn.addQuery('rest_message', parent.getUniqueValue());
        fn.orderBy('function_name');
        fn.query();
        while (fn.next()) {
            methods.push({
                // Just the function name: the response panel shows the actual sent URL.
                label: fn.getValue('function_name'),
                value: fn.getValue('function_name'),
                httpMethod: fn.getValue('http_method'),
                // Same fallback as _resolveFunction: a function may inherit the
                // parent message's endpoint.
                endpoint: fn.getValue('rest_endpoint') || parent.getValue('rest_endpoint'),
                // Stored auth, resolved through inherit_from_parent, so the client can
                // preselect the auth dropdown + profile when this method is chosen.
                auth: engine._mapStoredAuth(parent, fn)
            });
        }
        return methods;
    }

    /**
     * Variable substitutions (${name}) defined on a REST message function, read from
     * sys_rest_message_fn_parameters. Returned as [{name, value}] so the client can
     * seed one editable row per variable, pre-filled with the stored default value.
     */
    function _readVariables(restMessageId, functionName) {
        var vars = [];
        var parent = new RestExplorerEngine()._getRestMessage(restMessageId);
        if (!parent) {
            return vars;
        }
        var fn = new GlideRecord('sys_rest_message_fn');
        fn.addQuery('rest_message', parent.getUniqueValue());
        fn.addQuery('function_name', functionName);
        fn.query();
        if (!fn.next()) {
            return vars;
        }
        var p = new GlideRecord('sys_rest_message_fn_parameters');
        if (!p.isValid()) {
            return vars; // Table not present on this instance -- fail soft.
        }
        p.addQuery('rest_message_function', fn.getUniqueValue());
        p.orderBy('name');
        p.query();
        while (p.next()) {
            vars.push({
                name: p.getValue('name'),
                // Element `value` -- shown as "Test value" on the form (confirmed live).
                value: p.getValue('value') || ''
            });
        }
        return vars;
    }
})();
