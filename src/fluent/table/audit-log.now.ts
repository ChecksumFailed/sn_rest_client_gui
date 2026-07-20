import '@servicenow/sdk/global'
import {
    Table,
    ChoiceColumn,
    StringColumn,
    ReferenceColumn,
    IntegerColumn,
    BooleanColumn,
    Acl,
    Form,
    default_view,
    UiPolicy,
} from '@servicenow/sdk/core'
import { explorerUserRole } from '../security/roles.now'

/**
 * Audit trail of every RestExplorerEngine.execute() call, written by the engine itself
 * (RestExplorerEngine._logRequest) right before it returns -- successes, HTTP errors, and
 * refused/invalid calls alike, so denied attempts show up here too.
 *
 * `endpoint` stores the full request URL, including the query string, with values of
 * known-sensitive query parameters (API keys, tokens, secrets -- the configurable list in
 * x_1676196_rest_gui.sensitive_query_params, see properties.now.ts) redacted before insert.
 * Never stores request headers (Bearer tokens / Basic credentials live there). `request_body`
 * is only populated when the x_1676196_rest_gui.debug property is on -- see properties.now.ts
 * -- since request bodies can otherwise carry secrets a console like this must not leak a
 * second copy of. `oauth_profile` / `basic_auth_profile` record which stored credential
 * profile a call used (never both, and neither for manual-entry Basic, API key, or no auth) --
 * this is a reference to the profile record, not the credential itself.
 *
 * Read access is row-scoped: explorerUserRole holders can only read rows they created
 * (see auditLogReadOwnOnly below); admins see every row.
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
                restMessage: {
                    label: 'REST Message',
                    sequence: 1,
                },
                url: {
                    label: 'Direct URL',
                    sequence: 2,
                },
            },
        }),
        rest_message: ReferenceColumn({
            label: 'REST Message',
            referenceTable: 'sys_rest_message',
        }),
        function_name: StringColumn({ label: 'Function', maxLength: 100 }),
        http_method: StringColumn({ label: 'HTTP Method', maxLength: 10 }),
        // Populated from config.authProfile -- only the one matching auth_type is ever set
        // (see RestExplorerEngine._logRequest); never both, and neither for manual-basic/apikey/none.
        oauth_profile: ReferenceColumn({ label: 'OAuth Profile', referenceTable: 'oauth_entity_profile' }),
        basic_auth_profile: ReferenceColumn({ label: 'Basic Auth Profile', referenceTable: 'sys_auth_profile_basic' }),
        // Full URL including query string -- sensitive query param values are redacted
        // before insert (RestExplorerEngine._redactSensitiveQueryParams). See file header.
        endpoint: StringColumn({ label: 'Endpoint', maxLength: 4000 }),
        mid_server: StringColumn({ label: 'MID Server', maxLength: 100 }),
        // Values set by RestExplorerEngine._logRequest (config.authType || 'none') -- keep
        // in sync with the choices here.
        auth_type: ChoiceColumn({
            label: 'Auth Type',
            choices: {
                none: { label: 'None', sequence: 1 },
                basic: { label: 'Basic', sequence: 2 },
                apikey: { label: 'API Key', sequence: 3 },
                oauth: { label: 'OAuth 2.0', sequence: 4 },
            },
        }),
        status_code: IntegerColumn({ label: 'Status Code' }),
        ok: BooleanColumn({ label: 'Ok' }),
        // Error message only (see RestExplorerEngine._fail) -- never a response body.
        error: StringColumn({ label: 'Error', maxLength: 4000 }),
        duration_ms: IntegerColumn({ label: 'Duration (ms)' }),
        // Only populated when x_1676196_rest_gui.debug is on -- see file header.
        request_body: StringColumn({ label: 'Request Body', maxLength: 4000 }),
    },
    index: [
        {
            name: 'index2',
            unique: false,
            element: 'rest_message',
        },
        {
            name: 'index',
            unique: false,
            element: 'basic_auth_profile',
        },
        {
            name: 'index3',
            unique: false,
            element: 'oauth_profile',
        },
    ],
})

/**
 * Row-level restriction layered on top of the table's auto-generated read ACL
 * (createAccessControls/userRole above, which already requires explorerUserRole).
 * ACLs for the same table + operation AND together, so an explorerUserRole holder must
 * satisfy both: hold the role, AND have created the row. Admins bypass this one
 * (adminOverrides) and see every row -- the role check alone still applies to them, but
 * gs.hasRole-style role checks are automatically satisfied by the admin role.
 */
export const auditLogReadOwnOnly = Acl({
    $id: Now.ID['audit-log-read-own-only'],
    type: 'record',
    table: 'x_1676196_rest_gui_audit_log',
    operation: 'read',
    decisionType: 'allow',
    adminOverrides: true,
    script: 'return current.getValue("sys_created_by") == gs.getUserName();',
    description: 'Explorer-role users may only read audit log rows they created. Admins see all rows.',
})

/**
 * Explicit Default view form. Without this, Table() only emits a bare sys_ui_section (no
 * sys_ui_form / sys_ui_form_section wiring it in), which the platform does not recognize as
 * a complete form -- it renders that section AND falls back to auto-generating its own
 * unlabeled default layout on top, so the record view showed every field twice. Form()
 * creates the full sys_ui_form/_section/_element chain, so this is the one and only section.
 */
export const auditLogForm = Form({
    table: 'x_1676196_rest_gui_audit_log',
    view: default_view,
    sections: [
        {
            caption: 'Details',
            content: [
                {
                    layout: 'two-column',
                    leftElements: [{ field: 'source', type: 'table_field' }],
                    rightElements: [{ field: 'status_code', type: 'table_field' }],
                },
                {
                    layout: 'one-column',
                    elements: [{ field: 'endpoint', type: 'table_field' }],
                },
                {
                    layout: 'two-column',
                    leftElements: [{ field: 'duration_ms', type: 'table_field' }],
                    rightElements: [{ field: 'http_method', type: 'table_field' }],
                },
                {
                    layout: 'two-column',
                    leftElements: [{ field: 'auth_type', type: 'table_field' }],
                    rightElements: [{ field: 'function_name', type: 'table_field' }],
                },
                {
                    layout: 'two-column',
                    leftElements: [{ field: 'oauth_profile', type: 'table_field' }],
                    rightElements: [{ field: 'basic_auth_profile', type: 'table_field' }],
                },
                {
                    layout: 'one-column',
                    elements: [{ field: 'error', type: 'table_field' }],
                },
                {
                    layout: 'two-column',
                    leftElements: [{ field: 'mid_server', type: 'table_field' }],
                    rightElements: [{ field: 'request_body', type: 'table_field' }],
                },
                {
                    layout: 'two-column',
                    leftElements: [{ field: 'rest_message', type: 'table_field' }],
                    rightElements: [{ field: 'ok', type: 'table_field' }],
                },
            ],
        },
    ],
})

/**
 * Show oauth_profile only for auth_type=oauth rows (reverseIfFalse hides it otherwise) --
 * it's meaningless noise on a Basic/API key/no-auth row.
 */
export const auditLogShowOauthProfile = UiPolicy({
    $id: Now.ID['audit-log-show-oauth-profile'],
    table: 'x_1676196_rest_gui_audit_log',
    shortDescription: 'Show OAuth Profile only for OAuth calls',
    conditions: 'auth_type=oauth',
    reverseIfFalse: true,
    actions: [
        { field: 'oauth_profile', visible: true, mandatory: 'ignore', readOnly: 'ignore' },
    ],
})

/** Mirror of auditLogShowOauthProfile for basic_auth_profile / auth_type=basic. */
export const auditLogShowBasicAuthProfile = UiPolicy({
    $id: Now.ID['audit-log-show-basic-auth-profile'],
    table: 'x_1676196_rest_gui_audit_log',
    shortDescription: 'Show Basic Auth Profile only for Basic calls',
    conditions: 'auth_type=basic',
    reverseIfFalse: true,
    actions: [
        { field: 'basic_auth_profile', visible: true, mandatory: 'ignore', readOnly: 'ignore' },
    ],
})
