import '@servicenow/sdk/global'
import { SPWidget } from '@servicenow/sdk/core'

/**
 * Outbound REST Console -- a Swagger-UI-like interface for exercising REST Messages and
 * their HTTP methods. The server script brokers execution through RestExplorerEngine
 * (it never calls the REST APIs directly); access is gated in the server script and
 * the engine by the x_1676196_rest_gui.user role, so the widget renders a denied message
 * rather than being hidden from users without the role.
 */
export const restExplorerWidget = SPWidget({
    $id: Now.ID['rest-explorer-widget'],
    name: 'Outbound REST Console',
    id: 'x_1676196_rest_gui_rest_explorer',
    description:
        'Swagger-UI-like interface for exercising REST Messages, with Basic/API key/OAuth auth and optional MID-server routing.',
    serverScript: Now.include('./server_script.js'),
    clientScript: Now.include('./client_controller.js'),
    htmlTemplate: Now.include('./widget.html'),
    customCss: Now.include('./widget.css'),
    controllerAs: 'c',
    hasPreview: false,
    linkScript: Now.include('./sp_widget_x_1676196_rest_gui_rest_explorer/link-script.js'),
})
