import { Acl } from '@servicenow/sdk/core'

Acl({
    $id: Now.ID['d426a1c493160b10e4bb7ee32bba1021'],
    description: 'Allow write for all fields in x_1676196_rest_gui_audit_log, if the ACL script returns true.',
    localOrExisting: 'Existing',
    adminOverrides: false,
    type: 'record',
    operation: 'write',
    script: 'false;',
    table: 'x_1676196_rest_gui_audit_log',
    field: '*',
})
