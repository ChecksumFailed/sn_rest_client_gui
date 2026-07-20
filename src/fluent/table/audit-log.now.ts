import '@servicenow/sdk/global'
import { Table, ChoiceColumn, StringColumn, ReferenceColumn, IntegerColumn, BooleanColumn } from '@servicenow/sdk/core'
import { explorerUserRole } from '../security/roles.now'

/**
 * Audit trail of every RestExplorerEngine.execute() call, written by the engine itself
 * (RestExplorerEngine._logRequest) right before it returns -- successes, HTTP errors, and
 * refused/invalid calls alike, so denied attempts show up here too.
 *
 * Deliberately does NOT store request/response bodies, headers, or the query string: this
 * console's whole job is sending credentials (Bearer tokens, Basic passwords, API keys --
 * some placed IN the query string) to arbitrary endpoints, and an audit log must not become
 * a second place those leak from. `endpoint` is stored with its query string stripped.
 */
export const x_1676196_rest_gui_audit_log = Table({
    name: 'x_1676196_rest_gui_audit_log',
    label: 'REST Console Audit Log',
    display: 'endpoint',
    accessibleFrom: 'package_private',
    createAccessControls: true,
    userRole: explorerUserRole,
    schema: {
        source: ChoiceColumn({
            label: 'Source',
            mandatory: true,
            choices: {
                restMessage: 'REST Message',
                url: 'Direct URL',
            },
        }),
        rest_message: ReferenceColumn({
            label: 'REST Message',
            referenceTable: 'sys_rest_message',
        }),
        function_name: StringColumn({ label: 'Function', maxLength: 100 }),
        http_method: StringColumn({ label: 'HTTP Method', maxLength: 10 }),
        // Query string stripped before insert -- see file header.
        endpoint: StringColumn({ label: 'Endpoint', maxLength: 1024 }),
        mid_server: StringColumn({ label: 'MID Server', maxLength: 100 }),
        auth_type: StringColumn({ label: 'Auth Type', maxLength: 40 }),
        status_code: IntegerColumn({ label: 'Status Code' }),
        ok: BooleanColumn({ label: 'Ok' }),
        // Error message only (see RestExplorerEngine._fail) -- never a response body.
        error: StringColumn({ label: 'Error', maxLength: 4000 }),
        duration_ms: IntegerColumn({ label: 'Duration (ms)' }),
    },
})
