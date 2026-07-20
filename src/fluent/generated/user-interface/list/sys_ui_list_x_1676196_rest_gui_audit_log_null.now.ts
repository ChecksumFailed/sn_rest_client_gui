import { List, default_view } from '@servicenow/sdk/core'

List({
    table: 'x_1676196_rest_gui_audit_log',
    view: default_view,
    columns: [
        'auth_type',
        'duration_ms',
        'endpoint',
        'error',
        'function_name',
        'http_method',
        'mid_server',
        'ok',
        'rest_message',
        'source',
    ],
})
