import { Acl } from '@servicenow/sdk/core'

Acl({
    $id: Now.ID['c8952d4493160b10e4bb7ee32bba1093'],
    description: 'Allow write for records in x_1676196_rest_gui_audit_log, if the ACL script returns true.',
    localOrExisting: 'Existing',
    adminOverrides: false,
    type: 'record',
    operation: 'write',
    script: 'false;',
    table: 'x_1676196_rest_gui_audit_log',
})
