import '@servicenow/sdk/global'
import { ScriptInclude } from '@servicenow/sdk/core'

/**
 * Server-side broker for the Outbound REST Console widget. The only place that touches
 * sn_ws.RESTMessageV2 / sn_auth, and the home of the MID-server OAuth workaround.
 * Role-gated in execute() via gs.hasRole -- do not rely on the widget/page ACL alone.
 */
ScriptInclude({
    $id: Now.ID['rest-explorer-engine'],
    name: 'RestExplorerEngine',
    active: true,
    apiName: 'x_1676196_rest_gui.RestExplorerEngine',
    // Called from the widget server script (same scope), not from client GlideAjax.
    clientCallable: false,
    accessibleFrom: 'package_private',
    description:
        'Builds and executes outbound REST messages, applying auth per type and routing through a MID server when selected.',
    script: Now.include('./RestExplorerEngine.js'),
    mobileCallable: false,
    sandboxCallable: false,
})
