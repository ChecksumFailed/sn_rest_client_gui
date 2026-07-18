import '@servicenow/sdk/global'
import { ApplicationMenu, Record } from '@servicenow/sdk/core'

/**
 * Classic-UI entry point. The Outbound REST Console itself is a Service Portal widget
 * (AngularJS, SP runtime only), so we don't rebuild it as a UI Page -- instead we
 * add an Application Navigator menu whose module opens the SP page directly in the
 * platform content frame. Gated to the same role as the widget/engine.
 */
export const restExplorerMenu = ApplicationMenu({
    $id: Now.ID['rest-explorer-menu'],
    title: 'Outbound REST Console',
    hint: 'Swagger-UI-like tool for exercising REST Messages and raw URLs.',
    description: 'Launches the Outbound REST Console Service Portal page.',
    roles: ['admin', 'x_1676196_rest_gui.user'],
    active: true,
    category: '',
})

Record({
    $id: Now.ID['rest-explorer-module'],
    table: 'sys_app_module',
    data: {
        title: 'Outbound REST Console',
        application: restExplorerMenu,
        // DIRECT + query = open a relative URL; points at the dedicated chromeless portal
        // so it launches without the full portal UI. window_name targets a named window,
        // so it opens in a separate browser tab/window (reused on repeat clicks) instead
        // of the classic content frame.
        link_type: 'DIRECT',
        query: '/rest_console?id=rest_explorer',
        window_name: 'outbound_rest_console',
        hint: 'Open the Outbound REST Console portal page.',
        roles: ['admin', 'x_1676196_rest_gui.user'],
        active: true,
        order: 100,
        override_menu_roles: false,
        require_confirmation: false,
        sys_domain: 'global',
        sys_domain_path: '/',
        uncancelable: false,
    },
})
