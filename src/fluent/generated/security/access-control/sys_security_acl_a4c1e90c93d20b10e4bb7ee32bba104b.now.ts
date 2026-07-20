import { Acl } from '@servicenow/sdk/core'

Acl({
    $id: Now.ID['a4c1e90c93d20b10e4bb7ee32bba104b'],
    description:
        'Allow create for records in x_1676196_rest_gui_audit_log, for users with role x_1676196_rest_gui.user.',
    localOrExisting: 'Existing',
    type: 'record',
    operation: 'create',
    roles: ['x_1676196_rest_gui.user'],
    table: 'x_1676196_rest_gui_audit_log',
})
