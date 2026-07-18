import '@servicenow/sdk/global'
import { Role } from '@servicenow/sdk/core'

/**
 * Role required to run the Outbound REST Console. Checked in RestExplorerEngine.execute()
 * (EXPLORER_ROLE) and used to gate the widget's server script, so hitting the
 * widget endpoint directly is not enough without it.
 *
 * Treat this role as admin-adjacent: a holder can point any stored Basic Auth or
 * OAuth profile at an arbitrary URL (exfiltrating the credential/token) and reach
 * anything the instance or a MID server can reach. Grant accordingly.
 */
export const explorerUserRole = Role({
    name: 'x_1676196_rest_gui.user',
    description: 'Grants access to run outbound requests through the Outbound REST Console. Admin-adjacent: holders can send any stored outbound credential profile to an arbitrary URL and reach anything the instance or a MID server can reach.',
})
