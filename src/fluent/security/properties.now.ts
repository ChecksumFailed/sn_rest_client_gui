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
