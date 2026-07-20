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
    description: 'Fallback MID server name for Outbound REST Console when none is selected and none can be auto-detected.',
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
    value: 'true',
    description: 'Enables Direct URL mode in the Outbound REST Console (calling an arbitrary URL instead of a saved REST Message). Disable to restrict the console to vetted REST Message records only.',
    roles: {
        write: ['admin'],
    },
})
