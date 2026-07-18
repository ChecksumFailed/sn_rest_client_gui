import { CrossScopePrivilege } from '@servicenow/sdk/core'

CrossScopePrivilege({
    $id: Now.ID['3e284f13938a8310e4bb7ee32bba10e8'],
    operation: 'read',
    status: 'allowed',
    targetName: 'oauth_requestor_profile',
    targetScope: 'global',
    targetType: 'sys_db_object',
})
