/**
 * Unit tests for RestExplorerEngine (the server-side broker).
 *
 * The engine is a ServiceNow Script Include that relies on platform globals
 * (Class, gs, GlideRecord, sn_ws, sn_auth). We load the raw source into a
 * vm sandbox with mocked globals so the pure logic -- auth branching, the
 * cross-scope function resolve, MID async routing, validation, normalization --
 * can be exercised in plain Node with no instance. Run via `node --test`
 * (wired into the build through the `prebuild` npm hook).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_PATH = join(HERE, '..', 'src', 'fluent', 'script-include', 'RestExplorerEngine.js')
const ENGINE_SOURCE = readFileSync(ENGINE_PATH, 'utf8')

// --- Mocks -----------------------------------------------------------------

/** A RESTMessageV2 stand-in that records every call for assertions. */
function makeSpyMessage(response) {
    const calls = []
    let endpoint = ''
    const rec = (name) => (...args) => { calls.push({ name, args }) }
    const msg = {
        calls,
        setEndpoint: (ep) => { endpoint = ep; calls.push({ name: 'setEndpoint', args: [ep] }) },
        getEndpoint: () => endpoint,
        setHttpMethod: rec('setHttpMethod'),
        setRequestHeader: rec('setRequestHeader'),
        setQueryParameter: rec('setQueryParameter'),
        setStringParameterNoEscape: rec('setStringParameterNoEscape'),
        setBasicAuth: rec('setBasicAuth'),
        setAuthenticationProfile: rec('setAuthenticationProfile'),
        setRequestBody: rec('setRequestBody'),
        setMIDServer: rec('setMIDServer'),
        getRequestBody: () => '',
        execute() { calls.push({ name: 'execute', args: [] }); return response },
        executeAsync() {
            calls.push({ name: 'executeAsync', args: [] })
            return Object.assign({
                waitForResponse: (s) => calls.push({ name: 'waitForResponse', args: [s] }),
            }, response)
        },
    }
    // Convenience: names of calls in order, and a lookup for the first of a name.
    msg.names = () => calls.map((c) => c.name)
    msg.first = (name) => calls.find((c) => c.name === name)
    msg.all = (name) => calls.filter((c) => c.name === name)
    return msg
}

function makeResponse({ error = false, status = 200, headers = {}, body = '{}', errorCode = '', errorMessage = '' } = {}) {
    return {
        haveError: () => error,
        getStatusCode: () => status,
        getHeaders: () => headers,
        getBody: () => body,
        getErrorCode: () => errorCode,
        getErrorMessage: () => errorMessage,
    }
}

/** GlideRecord mock driven by an in-memory table map: { table: [rows...] }. Rows inserted
 *  via initialize()/setValue()/insert() are pushed back into the shared `tables[table]`
 *  array, so a test can inspect what a Script Include wrote (e.g. an audit log row). */
function makeGlideRecordClass(tables) {
    return function GlideRecord(table) {
        let rows = (tables[table] || []).slice()
        const queries = []
        let idx = -1
        let current = null
        return {
            isValid: () => Object.prototype.hasOwnProperty.call(tables, table),
            get(field, value) {
                if (value === undefined) { value = field; field = 'sys_id' }
                current = rows.find((r) => String(r[field]) === String(value)) || null
                return !!current
            },
            addQuery(f, v) { queries.push([f, v]) },
            addEncodedQuery() {},
            orderBy() {},
            query() {
                rows = rows.filter((r) => queries.every(([f, v]) => String(r[f]) === String(v)))
                idx = -1
            },
            next() { idx += 1; if (idx < rows.length) { current = rows[idx]; return true } return false },
            getValue(f) { return current && current[f] != null ? current[f] : '' },
            getUniqueValue() { return current ? current.sys_id : '' },
            initialize() { current = {} },
            setValue(f, v) { if (current) { current[f] = v } },
            insert() {
                current.sys_id = current.sys_id || ('mock' + ((tables[table] || []).length + 1))
                tables[table] = tables[table] || []
                tables[table].push(current)
                return current.sys_id
            },
        }
    }
}

/**
 * Load the engine into a fresh sandbox and return an instance plus the pieces
 * the tests want to inspect.
 */
function loadEngine({ hasRole, tables = {}, response, sn_auth = {}, getProperty } = {}) {
    const allow = hasRole || (() => true)
    const msg = makeSpyMessage(response || makeResponse())
    const warnings = []
    const sandbox = {
        Class: { create: () => function () { if (this.initialize) this.initialize.apply(this, arguments) } },
        gs: {
            hasRole: (r) => allow(r),
            warn: (m) => warnings.push(String(m)),
            getProperty: getProperty || ((k, d) => d),
        },
        GlideRecord: makeGlideRecordClass(tables),
        sn_ws: { RESTMessageV2: function () { return msg } },
        sn_auth,
    }
    vm.createContext(sandbox)
    vm.runInContext(ENGINE_SOURCE, sandbox)
    const Engine = sandbox.RestExplorerEngine
    return { engine: new Engine(), msg, warnings, Engine, tables }
}

const AUDIT_TABLE = 'x_1676196_rest_gui_audit_log'

const ROLE = 'x_1676196_rest_gui.user'

// A ready-made REST Message ("Cat Facts / Get Random Fact") for resolve tests.
function catFactsTables(extra = {}) {
    return {
        sys_rest_message: [{ sys_id: 'rm1', name: 'Cat Facts', rest_endpoint: '' }],
        sys_rest_message_fn: [{
            sys_id: 'fn1', rest_message: 'rm1', function_name: 'Get Random Fact',
            http_method: 'get', rest_endpoint: 'https://catfact.ninja/fact?max_length=${max_length}',
            content: '',
        }],
        sys_rest_message_fn_headers: extra.headers || [],
        sys_rest_message_fn_param_defs: extra.params || [],
    }
}

// --- Role gate -------------------------------------------------------------

test('execute() refuses a caller without the role or admin', () => {
    const { engine, msg } = loadEngine({ hasRole: () => false })
    const r = engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(r.ok, false)
    assert.match(r.error, /role required/)
    assert.equal(msg.calls.length, 0, 'no request should be built when denied')
})

test('execute() allows an admin even without the explorer role', () => {
    const { engine } = loadEngine({ hasRole: (r) => r === 'admin' })
    const r = engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(r.ok, true)
})

// --- Direct URL mode property gate ------------------------------------------

test('url mode is refused when the enable_direct_url property is off', () => {
    const { engine, msg } = loadEngine({
        getProperty: (k, d) => (k === 'x_1676196_rest_gui.enable_direct_url' ? 'false' : d),
    })
    const r = engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(r.ok, false)
    assert.match(r.error, /Direct URL mode is disabled/)
    assert.equal(msg.calls.length, 0, 'no request should be built when the mode is disabled')
})

test('url mode is allowed by default (property absent/unset)', () => {
    const { engine } = loadEngine()
    const r = engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(r.ok, true)
})

test('rest-message mode is unaffected by the direct-url property', () => {
    const { engine } = loadEngine({
        tables: catFactsTables(),
        getProperty: (k, d) => (k === 'x_1676196_rest_gui.enable_direct_url' ? 'false' : d),
    })
    const r = engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact' })
    assert.equal(r.ok, true)
})

// --- Validation ------------------------------------------------------------

test('url mode requires an endpoint', () => {
    const { engine } = loadEngine()
    const r = engine.execute({ source: 'url' })
    assert.equal(r.ok, false)
    assert.match(r.error, /URL is required/)
})

test('rest-message mode requires restMessage and method', () => {
    const { engine } = loadEngine()
    assert.match(engine.execute({ restMessage: 'Cat Facts' }).error, /required/)
    assert.match(engine.execute({ method: 'get' }).error, /required/)
})

// --- URL mode --------------------------------------------------------------

test('url mode builds a transient message and returns a normalized ok result', () => {
    const { engine, msg } = loadEngine({
        response: makeResponse({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"fact":"hi"}' }),
    })
    const r = engine.execute({ source: 'url', endpoint: 'https://catfact.ninja/fact', httpMethod: 'get' })
    assert.equal(r.ok, true)
    assert.equal(r.status, 200)
    assert.equal(r.body, '{"fact":"hi"}')
    assert.equal(msg.first('setEndpoint').args[0], 'https://catfact.ninja/fact')
    assert.equal(msg.first('setHttpMethod').args[0], 'get')
    assert.ok(msg.first('execute'), 'a direct (non-MID) call uses execute()')
    assert.equal(msg.first('executeAsync'), undefined)
})

test('url mode defaults the HTTP method to get', () => {
    const { engine, msg } = loadEngine()
    engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(msg.first('setHttpMethod').args[0], 'get')
})

test('url mode returns the fully constructed URL with substitutions and query params', () => {
    const { engine } = loadEngine()
    const r = engine.execute({
        source: 'url',
        endpoint: 'https://catfact.ninja/breeds?limit=${limit}',
        httpMethod: 'get',
        variables: { limit: '10' },
        queryParams: { extra: 'more cats' },
    })
    assert.equal(r.ok, true)
    assert.equal(r.url, 'https://catfact.ninja/breeds?limit=10&extra=more%20cats')
})

// --- REST Message mode / cross-scope resolve -------------------------------

test('rest-message mode resolves the function endpoint via GlideRecord (cross-scope safe)', () => {
    const { engine, msg } = loadEngine({ tables: catFactsTables() })
    const r = engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact' })
    assert.equal(r.ok, true)
    assert.equal(msg.first('setEndpoint').args[0], 'https://catfact.ninja/fact?max_length=${max_length}')
    assert.equal(msg.first('setHttpMethod').args[0], 'get')
})

test('rest-message mode resolves by sys_id too (the dropdown sends sys_id, not name)', () => {
    const { engine, msg } = loadEngine({ tables: catFactsTables() })
    const r = engine.execute({ source: 'restMessage', restMessage: 'rm1', method: 'Get Random Fact' })
    assert.equal(r.ok, true)
    assert.equal(msg.first('setEndpoint').args[0], 'https://catfact.ninja/fact?max_length=${max_length}')
})

test('rest-message mode errors clearly when the message is not found', () => {
    const { engine } = loadEngine({ tables: { sys_rest_message: [] } })
    const r = engine.execute({ source: 'restMessage', restMessage: 'Nope', method: 'get' })
    assert.equal(r.ok, false)
    assert.match(r.error, /was not found/)
})

test('rest-message mode applies the function static headers and query params', () => {
    const tables = catFactsTables({
        headers: [{ sys_id: 'h1', rest_message_function: 'fn1', name: 'Accept', value: 'application/json' }],
        params: [{ sys_id: 'p1', rest_message_function: 'fn1', name: 'limit', value: '5' }],
    })
    const { engine, msg } = loadEngine({ tables })
    engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact' })
    assert.deepEqual(msg.first('setRequestHeader').args, ['Accept', 'application/json'])
    assert.deepEqual(msg.first('setQueryParameter').args, ['limit', '5'])
})

test('defined query params / headers with ${token} values resolve from user variables', () => {
    // Real-world pattern (e.g. Yahoo Finance): bare endpoint, param_defs rows whose
    // VALUE is itself a substitution token (s=${symbol}). The engine resolves the
    // tokens it has variables for instead of relying on the platform substituting
    // into setQueryParameter/setRequestHeader values on a rebuilt transient message.
    const tables = catFactsTables({
        headers: [{ sys_id: 'h1', rest_message_function: 'fn1', name: 'X-Trace', value: '${trace}' }],
        params: [
            { sys_id: 'p1', rest_message_function: 'fn1', name: 's', value: '${symbol}', order: '100' },
            { sys_id: 'p2', rest_message_function: 'fn1', name: 'f', value: 'l1', order: '200' },
        ],
    })
    const { engine, msg } = loadEngine({ tables })
    engine.execute({
        source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact',
        variables: { symbol: 'AAPL', trace: 't-1' },
    })
    const q = Object.fromEntries(msg.all('setQueryParameter').map((c) => c.args))
    assert.deepEqual(q, { s: 'AAPL', f: 'l1' })
    assert.deepEqual(msg.first('setRequestHeader').args, ['X-Trace', 't-1'])
})

test('an unresolved ${token} in a defined query param is left intact for the platform', () => {
    const tables = catFactsTables({
        params: [{ sys_id: 'p1', rest_message_function: 'fn1', name: 's', value: '${symbol}', order: '100' }],
    })
    const { engine, msg } = loadEngine({ tables })
    engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact' })
    assert.deepEqual(msg.first('setQueryParameter').args, ['s', '${symbol}'])
})

test('function default body is used only when the user leaves the body blank', () => {
    const tables = catFactsTables()
    tables.sys_rest_message_fn[0].content = '{"default":true}'
    // blank user body -> falls back to the function content
    let h = loadEngine({ tables })
    h.engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact' })
    assert.equal(h.msg.first('setRequestBody').args[0], '{"default":true}')
    // user body wins
    h = loadEngine({ tables })
    h.engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact', body: '{"mine":1}' })
    assert.equal(h.msg.first('setRequestBody').args[0], '{"mine":1}')
})

test('rest-message mode returns the fully constructed URL with substitutions and function params', () => {
    const tables = catFactsTables({
        params: [
            { sys_id: 'p1', rest_message_function: 'fn1', name: 'limit', value: '5', order: '100' },
            { sys_id: 'p2', rest_message_function: 'fn1', name: 's', value: '${symbol}', order: '200' },
        ],
    })
    const { engine } = loadEngine({ tables })
    const r = engine.execute({
        source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact',
        variables: { max_length: '140', symbol: 'AAPL' },
    })
    assert.equal(r.ok, true)
    assert.equal(r.url, 'https://catfact.ninja/fact?max_length=140&limit=5&s=AAPL')
})

// --- Authentication --------------------------------------------------------

test('basic auth (profile) sets the basic authentication profile', () => {
    const { engine, msg } = loadEngine()
    engine.execute({ source: 'url', endpoint: 'https://x', authType: 'basic', authProfile: 'prof123' })
    assert.deepEqual(msg.first('setAuthenticationProfile').args, ['basic', 'prof123'])
})

test('basic auth (profile) fails when no profile is chosen', () => {
    const { engine } = loadEngine()
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'basic' })
    assert.match(r.error, /no Basic Auth profile/)
})

test('basic auth (manual) calls setBasicAuth with the typed credentials', () => {
    const { engine, msg } = loadEngine()
    engine.execute({
        source: 'url', endpoint: 'https://x', authType: 'basic',
        basic: { mode: 'manual', username: 'joe', password: 'secret' },
    })
    assert.deepEqual(msg.first('setBasicAuth').args, ['joe', 'secret'])
})

test('basic auth (manual) requires a username', () => {
    const { engine } = loadEngine()
    const r = engine.execute({
        source: 'url', endpoint: 'https://x', authType: 'basic',
        basic: { mode: 'manual', username: '', password: 'x' },
    })
    assert.match(r.error, /no username/)
})

test('api key in a header vs a query param', () => {
    let h = loadEngine()
    h.engine.execute({ source: 'url', endpoint: 'https://x', authType: 'apikey', apiKey: { placement: 'header', name: 'X-API-Key', value: 'k' } })
    assert.deepEqual(h.msg.first('setRequestHeader').args, ['X-API-Key', 'k'])

    // Query placement appends a REAL query parameter when the endpoint has no
    // ${token} -- substitution alone would silently drop the key and the request
    // would fire unauthenticated.
    h = loadEngine()
    h.engine.execute({ source: 'url', endpoint: 'https://x', authType: 'apikey', apiKey: { placement: 'query', name: 'api_key', value: 'k' } })
    assert.deepEqual(h.msg.first('setQueryParameter').args, ['api_key', 'k'])
    assert.equal(h.msg.all('setStringParameterNoEscape').length, 0)
})

test('api key (query) substitutes instead when the endpoint has a matching ${token}', () => {
    const { engine, msg } = loadEngine()
    engine.execute({ source: 'url', endpoint: 'https://x?key=${api_key}', authType: 'apikey', apiKey: { placement: 'query', name: 'api_key', value: 'k' } })
    assert.deepEqual(msg.first('setStringParameterNoEscape').args, ['api_key', 'k'])
    assert.equal(msg.all('setQueryParameter').length, 0)
})

test('api key with an empty value is rejected, not sent as an empty credential', () => {
    // '' must not pass the guard: the widget's post-OAuth state restore blanks
    // stored secrets, and an empty header would fire a silent 401 instead of
    // this validation error.
    const { engine, msg } = loadEngine()
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'apikey', apiKey: { placement: 'header', name: 'X-API-Key', value: '' } })
    assert.match(r.error, /key name\/value is missing/)
    assert.equal(msg.all('setRequestHeader').length, 0)
})

test('unknown auth type is rejected', () => {
    const { engine } = loadEngine()
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'weird' })
    assert.match(r.error, /Unknown authentication type/)
})

// --- OAuth (the MID-server workaround) -------------------------------------

function oauthMock({ accessToken = 'TOKEN', expiresIn = 9999, cached = true, refreshedAccessToken = 'REFRESHED', tokenResponseDetail = null, tokensByRequestor = null } = {}) {
    const calls = { requestTokenByRequest: 0, params: [], midServer: null, getToken: [] }
    const cachedToken = {
        getExpiresIn: () => expiresIn,
        getAccessToken: () => accessToken,
    }
    const refreshedToken = {
        getExpiresIn: () => 9999,
        getAccessToken: () => refreshedAccessToken,
    }
    return {
        calls,
        GlideOAuthClient: function () {
            return {
                // tokensByRequestor maps a requestor id to { accessToken, expiresIn };
                // when set, only those requestors have a stored token. Otherwise the
                // legacy behavior: every lookup returns the one cached token (or none).
                getToken: (requestor) => {
                    calls.getToken.push(requestor)
                    if (tokensByRequestor) {
                        const t = tokensByRequestor[requestor]
                        return t ? { getExpiresIn: () => t.expiresIn ?? 9999, getAccessToken: () => t.accessToken } : null
                    }
                    return cached ? cachedToken : null
                },
                requestTokenByRequest: () => {
                    calls.requestTokenByRequest += 1
                    return Object.assign({ getToken: () => refreshedToken }, tokenResponseDetail)
                },
            }
        },
        GlideOAuthClientRequest: function () {
            return {
                setParameter: (k, v) => calls.params.push([k, v]),
                setMIDServer: (m) => { calls.midServer = m },
            }
        },
    }
}

test('oauth injects a manual Bearer header and disables record auth', () => {
    const { engine, msg } = loadEngine({ sn_auth: oauthMock({ accessToken: 'ABC' }) })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1' })
    assert.equal(r.ok, true)
    assert.deepEqual(msg.first('setRequestHeader').args, ['Authorization', 'Bearer ABC'])
    assert.deepEqual(msg.first('setAuthenticationProfile').args, ['no_authentication'])
})

test('oauth refreshes an expiring token via requestTokenByRequest', () => {
    const auth = oauthMock({ expiresIn: 10, refreshedAccessToken: 'NEW' })
    const { engine, msg } = loadEngine({ sn_auth: auth })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1' })
    assert.equal(r.ok, true)
    assert.equal(auth.calls.requestTokenByRequest, 1, 'an expiring token must be refreshed')
    assert.deepEqual(msg.first('setRequestHeader').args, ['Authorization', 'Bearer NEW'])
    const params = Object.fromEntries(auth.calls.params)
    assert.equal(params.oauth_provider_profile, 'oap1')
    assert.equal(params.oauth_requestor_context, 'rest')
})

test('oauth requestor id is passed on the token request when supplied', () => {
    const auth = oauthMock({ cached: false })
    const { engine } = loadEngine({ sn_auth: auth })
    engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1', requestorId: 'req42' })
    const params = Object.fromEntries(auth.calls.params)
    assert.equal(params.oauth_requestor, 'req42')
})

test('oauth + MID routes the token request itself through the MID server', () => {
    const auth = oauthMock({ cached: false })
    const { engine, msg } = loadEngine({ sn_auth: auth })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1', midServer: 'MID01' })
    assert.equal(r.ok, true)
    assert.equal(auth.calls.midServer, 'MID01', 'the token request must be MID-routed too')
    assert.deepEqual(msg.first('setMIDServer').args, ['MID01'])
    assert.ok(msg.first('executeAsync'), 'the message itself stays async over MID')
})

test('a token refresh that returns no access token is a clear error, not "Bearer undefined"', () => {
    const auth = oauthMock({ cached: false, refreshedAccessToken: '' })
    const { engine, msg } = loadEngine({ sn_auth: auth })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1' })
    assert.equal(r.ok, false)
    assert.match(r.error, /no access token/)
    assert.equal(msg.first('execute'), undefined, 'must not send the request')
})

test('oauth reuses a token minted from the REST message record ("Get OAuth Token")', () => {
    // Authorization-code providers (GitHub) cannot mint headlessly: the token the
    // user minted interactively is stored against the REST message record, and the
    // console must find it there.
    const auth = oauthMock({ tokensByRequestor: { rm1: { accessToken: 'FROM-MESSAGE' } }, refreshedAccessToken: '' })
    const { engine, msg } = loadEngine({ sn_auth: auth, tables: catFactsTables() })
    const r = engine.execute({
        source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact',
        authType: 'oauth', authProfile: 'oap1',
    })
    assert.equal(r.ok, true)
    assert.deepEqual(msg.first('setRequestHeader').args, ['Authorization', 'Bearer FROM-MESSAGE'])
    assert.equal(auth.calls.requestTokenByRequest, 0, 'a fresh stored token must not trigger a mint')
})

test('oauth (direct URL) reuses a token minted against the entity profile ("Get OAuth Token")', () => {
    // Direct URL mode has no REST message record, so the interactive mint stores the
    // token against the entity profile itself (oauth_requestor = profile). The console
    // must search that requestor, or OAuth can never work for a direct URL.
    const auth = oauthMock({ tokensByRequestor: { oap1: { accessToken: 'FROM-PROFILE' } }, refreshedAccessToken: '' })
    const { engine, msg } = loadEngine({ sn_auth: auth })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1' })
    assert.equal(r.ok, true)
    assert.deepEqual(msg.first('setRequestHeader').args, ['Authorization', 'Bearer FROM-PROFILE'])
    assert.equal(auth.calls.requestTokenByRequest, 0, 'a fresh stored token must not trigger a mint')
})

test('oauth finds a token via the profile requestor registrations (credential page)', () => {
    const auth = oauthMock({ tokensByRequestor: { cred9: { accessToken: 'FROM-CRED' } }, refreshedAccessToken: '' })
    const tables = {
        oauth_requestor_profile: [
            { sys_id: 'rp1', oauth_entity_profile: 'oap1', oauth_requestor: 'cred9' },
            { sys_id: 'rp2', oauth_entity_profile: 'other-profile', oauth_requestor: 'wrong' },
        ],
    }
    const { engine, msg } = loadEngine({ sn_auth: auth, tables })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1' })
    assert.equal(r.ok, true)
    assert.deepEqual(msg.first('setRequestHeader').args, ['Authorization', 'Bearer FROM-CRED'])
    assert.ok(!auth.calls.getToken.includes('wrong'), 'requestor rows of other profiles must not be tried')
})

test('oauth falls back to a stale stored token when the mint fails', () => {
    const auth = oauthMock({ cached: true, expiresIn: 10, accessToken: 'STALE', refreshedAccessToken: '' })
    const { engine, msg, warnings } = loadEngine({ sn_auth: auth })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1' })
    assert.equal(r.ok, true, 'a stale token beats no token')
    assert.deepEqual(msg.first('setRequestHeader').args, ['Authorization', 'Bearer STALE'])
    assert.equal(auth.calls.requestTokenByRequest, 1, 'a refresh must still be attempted first')
    assert.ok(warnings.some((w) => /may be expired/.test(w)), 'the fallback must be logged')
})

test('a failed token mint surfaces the provider response diagnostics', () => {
    const auth = oauthMock({
        cached: false,
        refreshedAccessToken: '',
        tokenResponseDetail: {
            getResponseCode: () => '401',
            getErrorMessage: () => 'access_denied',
            getBody: () => '{"error":"invalid_client"}',
        },
    })
    const { engine } = loadEngine({ sn_auth: auth })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth', authProfile: 'oap1' })
    assert.equal(r.ok, false)
    assert.match(r.error, /no access token/)
    assert.match(r.error, /HTTP 401/)
    assert.match(r.error, /access_denied/)
    assert.match(r.error, /invalid_client/)
})

test('oauth without a profile fails instead of firing "Bearer undefined"', () => {
    const { engine, msg } = loadEngine({ sn_auth: oauthMock() })
    const r = engine.execute({ source: 'url', endpoint: 'https://x', authType: 'oauth' })
    assert.equal(r.ok, false)
    assert.match(r.error, /no OAuth Entity Profile/)
    assert.equal(msg.first('execute'), undefined, 'must not send the request')
})

// --- MID routing -----------------------------------------------------------

test('a MID server routes asynchronously (executeAsync + waitForResponse + setMIDServer)', () => {
    const { engine, msg } = loadEngine()
    const r = engine.execute({ source: 'url', endpoint: 'https://x', midServer: 'MID01' })
    assert.equal(r.ok, true)
    assert.deepEqual(msg.first('setMIDServer').args, ['MID01'])
    assert.ok(msg.first('executeAsync'), 'MID-routed calls are async')
    assert.ok(msg.first('waitForResponse'))
    assert.equal(msg.first('execute'), undefined)
})

test('MID timeout defaults to 60 and accepts a user-supplied number of seconds', () => {
    let h = loadEngine()
    h.engine.execute({ source: 'url', endpoint: 'https://x', midServer: 'M' })
    assert.deepEqual(h.msg.first('waitForResponse').args, [60])

    h = loadEngine()
    h.engine.execute({ source: 'url', endpoint: 'https://x', midServer: 'M', timeout: '120' })
    assert.deepEqual(h.msg.first('waitForResponse').args, [120])

    // Garbage falls back to the default rather than waiting 0/NaN seconds.
    h = loadEngine()
    h.engine.execute({ source: 'url', endpoint: 'https://x', midServer: 'M', timeout: 'soon' })
    assert.deepEqual(h.msg.first('waitForResponse').args, [60])
})

// --- Variables + normalization --------------------------------------------

test('url mode: queryParams are appended as query parameters', () => {
    const { engine, msg } = loadEngine()
    engine.execute({ source: 'url', endpoint: 'https://x', queryParams: { max_length: '140', limit: '5' } })
    const q = Object.fromEntries(msg.all('setQueryParameter').map((c) => c.args))
    assert.deepEqual(q, { max_length: '140', limit: '5' })
    assert.equal(msg.all('setStringParameterNoEscape').length, 0, 'no substitution when no variables')
})

test('url mode: variables are substitution-only and do not auto-append', () => {
    const { engine, msg } = loadEngine()
    engine.execute({ source: 'url', endpoint: 'https://x', variables: { limit: '5' } })
    assert.equal(msg.all('setQueryParameter').length, 0, 'variables are not appended as query params')
    assert.deepEqual(msg.first('setStringParameterNoEscape').args, ['limit', '5'])
})

test('url mode: a variable matching a ${token} substitutes and is not also duplicated on the query string', () => {
    const { engine, msg } = loadEngine()
    engine.execute({ source: 'url', endpoint: 'https://x?max_length=${max_length}', variables: { max_length: '140' } })
    assert.deepEqual(msg.first('setStringParameterNoEscape').args, ['max_length', '140'])
    assert.equal(msg.all('setQueryParameter').length, 0)
})

test('url mode: a ${token} in the request BODY substitutes instead of appending a query param', () => {
    const { engine, msg } = loadEngine()
    engine.execute({ source: 'url', endpoint: 'https://x', httpMethod: 'post', body: '{"who":"${name}"}', variables: { name: 'joe' } })
    assert.deepEqual(msg.first('setStringParameterNoEscape').args, ['name', 'joe'])
    assert.equal(msg.all('setQueryParameter').length, 0)
})

test('rest-message mode: variables substitute and are never appended as query params', () => {
    const { engine, msg } = loadEngine({ tables: catFactsTables() })
    engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact', variables: { max_length: '140' } })
    assert.deepEqual(msg.first('setStringParameterNoEscape').args, ['max_length', '140'])
    assert.equal(msg.all('setQueryParameter').length, 0)
})

test('rest-message mode: queryParams are appended to the URL', () => {
    const { engine } = loadEngine({ tables: catFactsTables() })
    const r = engine.execute({
        source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact',
        variables: { max_length: '140' },
        queryParams: { format: 'json' },
    })
    assert.equal(r.ok, true)
    assert.equal(r.url, 'https://catfact.ninja/fact?max_length=140&format=json')
})

test('a response with haveError() is normalized to ok:false with an error code', () => {
    const response = makeResponse({ error: true, status: 500, errorCode: '500', errorMessage: 'boom' })
    const { engine } = loadEngine({ response })
    const r = engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(r.ok, false)
    assert.equal(r.status, 500)
    assert.equal(r.error, '500: boom')
})

test('response headers fall back to getAllHeaders() when getHeaders() yields nothing', () => {
    // On the instance getHeaders() is a wrapped Java map that may not enumerate;
    // the engine then rebuilds the map from the getAllHeaders() list.
    const response = makeResponse({ body: 'ok' })
    response.getHeaders = () => ({})
    response.getAllHeaders = () => [{ getName: () => 'Content-Type', getValue: () => 'text/plain' }]
    const { engine } = loadEngine({ response })
    const r = engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.deepEqual({ ...r.headers }, { 'Content-Type': 'text/plain' })
})

// --- Stored auth resolution (UI preselect) ---------------------------------
// _mapStoredAuth maps a function's configured auth to the widget model so the UI
// can preselect the auth dropdown. It reads only .getValue() off two records, so
// a plain stub stands in for a GlideRecord.

/** Minimal GlideRecord stand-in for _mapStoredAuth (getValue only). */
function rec(vals) {
    return { getValue: (f) => (vals[f] != null ? vals[f] : '') }
}

test('stored auth: function basic with a profile preselects the profile picker', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(
        rec({ authentication_type: 'no_authentication' }),
        rec({ authentication_type: 'basic', basic_auth_profile: 'bp1', basic_auth_user: 'joe' }),
    )
    assert.deepEqual({ ...auth }, { type: 'basic', mode: 'profile', profile: 'bp1', username: 'joe' })
})

test('stored auth: function basic without a profile falls back to manual + username', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(
        rec({}),
        rec({ authentication_type: 'basic', basic_auth_user: 'joe' }),
    )
    assert.deepEqual({ ...auth }, { type: 'basic', mode: 'manual', profile: '', username: 'joe' })
})

test('stored auth: basic_simple maps to the basic model', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(
        rec({}),
        rec({ authentication_type: 'basic_simple', basic_auth_profile: 'bp2' }),
    )
    assert.equal(auth.type, 'basic')
    assert.equal(auth.profile, 'bp2')
})

test('stored auth: function oauth2 preselects the OAuth profile', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(
        rec({}),
        rec({ authentication_type: 'oauth2', oauth2_profile: 'op1' }),
    )
    assert.deepEqual({ ...auth }, { type: 'oauth', mode: 'profile', profile: 'op1', username: '' })
})

test('stored auth: no_authentication yields no preselection', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(rec({}), rec({ authentication_type: 'no_authentication' }))
    assert.deepEqual({ ...auth }, { type: 'none', mode: 'profile', profile: '', username: '' })
})

test('stored auth: inherit_from_parent uses the parent type AND the parent profile', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(
        rec({ authentication_type: 'oauth2', oauth2_profile: 'parentOauth' }),
        rec({ authentication_type: 'inherit_from_parent', oauth2_profile: 'ignoredChild' }),
    )
    assert.deepEqual({ ...auth }, { type: 'oauth', mode: 'profile', profile: 'parentOauth', username: '' })
})

test('stored auth: an unset function type is treated as inherit (falls back to parent)', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(
        rec({ authentication_type: 'basic', basic_auth_profile: 'parentBasic' }),
        rec({}),
    )
    assert.deepEqual({ ...auth }, { type: 'basic', mode: 'profile', profile: 'parentBasic', username: '' })
})

test('stored auth: mutual auth / unrecognized types get no preselection', () => {
    const { engine } = loadEngine()
    const auth = engine._mapStoredAuth(rec({}), rec({ authentication_type: 'mutual_auth' }))
    assert.equal(auth.type, 'none')
})

// --- Audit log ---------------------------------------------------------------
// The engine writes one row per execute() call via _logRequest(), regardless of
// success/failure, as long as the audit table exists on the instance.

test('a successful call writes an audit row with the full URL but a redacted secret', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({
        source: 'url', endpoint: 'https://x', httpMethod: 'get',
        authType: 'apikey', apiKey: { placement: 'query', name: 'token', value: 'SECRET' },
    })
    assert.equal(tables[AUDIT_TABLE].length, 1)
    const row = tables[AUDIT_TABLE][0]
    assert.equal(row.source, 'url')
    assert.equal(row.endpoint, 'https://x?token=REDACTED', 'full URL kept, but the sensitive param value redacted')
    assert.equal(row.http_method, 'get')
    assert.equal(row.auth_type, 'apikey')
    assert.equal(row.ok, true)
    assert.equal(row.status_code, 200)
    assert.equal(JSON.stringify(row).indexOf('SECRET'), -1, 'no secret value anywhere in the logged row')
})

test('a non-sensitive query parameter is kept as-is in the logged URL', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({ source: 'url', endpoint: 'https://x?limit=10&format=json', httpMethod: 'get' })
    assert.equal(tables[AUDIT_TABLE][0].endpoint, 'https://x?limit=10&format=json')
})

test('a custom-named API key query param is redacted even off the generic denylist', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({
        source: 'url', endpoint: 'https://x?limit=10', httpMethod: 'get',
        authType: 'apikey', apiKey: { placement: 'query', name: 'rapidapi_key', value: 'SECRET' },
    })
    const row = tables[AUDIT_TABLE][0]
    assert.equal(row.endpoint, 'https://x?limit=10&rapidapi_key=REDACTED')
    assert.equal(JSON.stringify(row).indexOf('SECRET'), -1)
})

test('request_body is not captured when the debug property is off (default)', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({ source: 'url', endpoint: 'https://x', httpMethod: 'post', body: '{"password":"hunter2"}' })
    assert.equal(tables[AUDIT_TABLE][0].request_body, '')
})

test('request_body is captured when the debug property is on', () => {
    const { engine, tables } = loadEngine({
        tables: { [AUDIT_TABLE]: [] },
        getProperty: (k, d) => (k === 'x_1676196_rest_gui.debug' ? 'true' : d),
    })
    engine.execute({ source: 'url', endpoint: 'https://x', httpMethod: 'post', body: '{"a":1}' })
    assert.equal(tables[AUDIT_TABLE][0].request_body, '{"a":1}')
})

test('audit row records the OAuth profile used, and leaves basic_auth_profile blank', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({
        source: 'url', endpoint: 'https://x', httpMethod: 'get',
        authType: 'oauth', authProfile: 'oauth-profile-1',
    })
    const row = tables[AUDIT_TABLE][0]
    assert.equal(row.oauth_profile, 'oauth-profile-1')
    assert.equal(row.basic_auth_profile, '')
})

test('audit row records the Basic Auth profile used, and leaves oauth_profile blank', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({
        source: 'url', endpoint: 'https://x', httpMethod: 'get',
        authType: 'basic', authProfile: 'basic-profile-1',
    })
    const row = tables[AUDIT_TABLE][0]
    assert.equal(row.basic_auth_profile, 'basic-profile-1')
    assert.equal(row.oauth_profile, '')
})

test('audit row leaves both profile fields blank for manual-entry basic auth', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({
        source: 'url', endpoint: 'https://x', httpMethod: 'get',
        authType: 'basic', basic: { mode: 'manual', username: 'u', password: 'p' },
    })
    const row = tables[AUDIT_TABLE][0]
    assert.equal(row.basic_auth_profile, '')
    assert.equal(row.oauth_profile, '')
})

test('audit row leaves both profile fields blank for API key / no auth', () => {
    const { engine, tables } = loadEngine({ tables: { [AUDIT_TABLE]: [] } })
    engine.execute({
        source: 'url', endpoint: 'https://x', httpMethod: 'get',
        authType: 'apikey', apiKey: { placement: 'header', name: 'X-Key', value: 'v' },
    })
    const row = tables[AUDIT_TABLE][0]
    assert.equal(row.basic_auth_profile, '')
    assert.equal(row.oauth_profile, '')
})

test('a refused call (missing role) still writes an audit row', () => {
    const { engine, tables } = loadEngine({ hasRole: () => false, tables: { [AUDIT_TABLE]: [] } })
    engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(tables[AUDIT_TABLE].length, 1)
    assert.equal(tables[AUDIT_TABLE][0].ok, false)
    assert.match(tables[AUDIT_TABLE][0].error, /role required/)
})

test('a REST message call logs the message id and function name, not the endpoint template', () => {
    const { engine, tables } = loadEngine({ tables: Object.assign({ [AUDIT_TABLE]: [] }, catFactsTables()) })
    engine.execute({ source: 'restMessage', restMessage: 'Cat Facts', method: 'Get Random Fact', variables: { max_length: '140' } })
    const row = tables[AUDIT_TABLE][0]
    assert.equal(row.source, 'restMessage')
    assert.equal(row.rest_message, 'Cat Facts')
    assert.equal(row.function_name, 'Get Random Fact')
    assert.equal(row.endpoint, 'https://catfact.ninja/fact?max_length=140', 'full resolved URL, including substituted tokens')
})

test('missing audit table fails soft -- execute() still returns its result', () => {
    const { engine } = loadEngine() // no AUDIT_TABLE entry in `tables`
    const r = engine.execute({ source: 'url', endpoint: 'https://x' })
    assert.equal(r.ok, true)
})
