import { Acl } from '@servicenow/sdk/core'

Acl({
    $id: Now.ID['9ce4adc093160b10e4bb7ee32bba10ca'],
    description: 'Allow delete for records in x_1676196_rest_gui_audit_log, for users with role admin.',
    localOrExisting: 'Existing',
    type: 'record',
    operation: 'delete',
    roles: ['admin'],
    table: 'x_1676196_rest_gui_audit_log',
})
