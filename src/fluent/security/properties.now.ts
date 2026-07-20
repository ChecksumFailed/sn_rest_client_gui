import '@servicenow/sdk/global'
import { Property } from '@servicenow/sdk/core'

/**
 * Fallback MID server name, read by RestExplorerEngine (DEFAULT_MID_PROPERTY) only
 * when a MID server is needed but none was supplied and OAuthMidSelector returned
 * nothing. Empty by default; configure per-instance.
 */
Property({
    $id: Now.ID['default-mid-server'],
    name: 'x_1676196_rest_gui.default_mid_server',
    type: 'string',
    value: '',
    description:
        'Fallback MID server name for Outbound REST Console when none is selected and none can be auto-detected.',
})

/**
 * Enables/disables Direct URL mode (config.source === 'url' in RestExplorerEngine).
 * Checked both server-side (RestExplorerEngine.execute(), so disabling it is not just
 * a UI hide) and by the widget server script (to hide the "Direct URL" radio option).
 * Direct URL mode lets a holder of the explorer role send any stored auth profile to an
 * ARBITRARY host, not just vetted REST Message records -- disable on instances where
 * outbound calls should be restricted to pre-approved endpoints.
 */
Property({
    $id: Now.ID['enable-direct-url'],
    name: 'x_1676196_rest_gui.enable_direct_url',
    type: 'boolean',
    value: 'false',
    description:
        'Enables Direct URL mode in the Outbound REST Console (calling an arbitrary URL instead of a saved REST Message). Disable to restrict the console to vetted REST Message records only.',
    roles: {
        write: ['admin'],
    },
})

/**
 * Gates request-body capture in the audit log (RestExplorerEngine.DEBUG_PROPERTY /
 * _debugEnabled / the audit log's `request_body` column). Off by default -- request
 * bodies routinely carry secrets (passwords, tokens embedded in a payload), so an admin
 * has to explicitly opt in per-instance rather than have every call's body logged.
 */
Property({
    $id: Now.ID['debug'],
    name: 'x_1676196_rest_gui.debug',
    type: 'boolean',
    value: 'false',
    description:
        'When enabled, the Outbound REST Console audit log also captures the request body sent with each call. Off by default -- request bodies can contain secrets, so only enable for troubleshooting.',
    roles: {
        write: ['admin'],
    },
})

/**
 * Comma-separated, case-insensitive list of query parameter names whose values
 * RestExplorerEngine._redactSensitiveQueryParams always redacts before a request URL is
 * written to the audit log (endpoint column), regardless of auth type. Setting this
 * REPLACES the built-in default list rather than adding to it -- copy the default value
 * below into the new value first if you just want to add a name.
 */
Property({
    $id: Now.ID['sensitive-query-params'],
    name: 'x_1676196_rest_gui.sensitive_query_params',
    type: 'string',
    value: 'api_key,apikey,api-key,key,access_token,token,secret,client_secret,password,pwd,auth,authorization,sig,signature',
    description:
        'Comma-separated, case-insensitive query parameter names whose values are always redacted (replaced with REDACTED) before a request URL is written to the Outbound REST Console audit log. Setting this replaces the built-in default list rather than adding to it.',
    roles: {
        write: ['admin'],
    },
})
