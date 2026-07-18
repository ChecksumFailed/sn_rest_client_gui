# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Targets a personal developer instance (PDI) as scope `x_1676196_rest_gui` / app "REST Client GUI" (config in `now.config.json`). This is a **now-sdk (ServiceNow Fluent) scoped application**. Build with `npm run build` (`now-sdk build`) and deploy with `npm run deploy` (`now-sdk install`).

**Rename note (2026-07-18):** the app was renamed from scope `x_1676196_swagger` / "Swagger UI" — a ServiceNow scope is immutable, so this is a *new* app with a fresh `scopeId` and regenerated `keys.ts`. The old `x_1676196_swagger` app may still be installed on the dev instance; uninstall it (System Applications) before or right after deploying the new scope, or the two portals/pages will coexist confusingly. Scope names are capped at 18 characters, hence `rest_gui` rather than `rest_client_gui`.

**Tests:** `npm test` (`node --test`) runs a Node unit suite for `RestExplorerEngine` in `test/`. It loads the raw Script Include into a `vm` sandbox with mocked Glide globals (`gs`, `GlideRecord`, `sn_ws`, `sn_auth`) — no instance needed — and covers auth branching, the cross-scope function resolve, MID async routing, validation, and normalization. The suite is wired into the build via the `prebuild` npm hook, so **a failing test blocks `npm run build`** (note: calling `now-sdk build` directly bypasses it — build via `npm run build`). No linter. See `README.md` for the remaining instance-side verification.

## Layout

Fluent definitions live in `src/fluent/**/*.now.ts`; each references its co-located raw source (`.js` / `.html` / `.css`) via `Now.include()`. The build emits update-set XML to `dist/app/update/`.

- `src/fluent/script-include/` — `rest-explorer-engine.now.ts` (`ScriptInclude`) + `RestExplorerEngine.js`. Server-side broker; the only place that touches `sn_ws.RESTMessageV2` / `sn_auth`. Role-gated in `execute()` via `gs.hasRole` (do not rely on the widget/page ACL alone). Auth is applied per type; **all failures return an error object, never a silent `undefined`** — the anti-pattern that made the reference util fire `Bearer undefined`.
- `src/fluent/sp-widget/rest_explorer/` — `widget.now.ts` (`SPWidget`) + `server_script.js`, `client_controller.js`, `widget.html`, `widget.css`. Server script populates dropdowns and brokers execution; it never calls the REST APIs directly.
- `src/fluent/sp-page/rest-explorer-page.now.ts` — `SPPage` (`?id=rest_explorer`) hosting one instance of the widget.
- `src/fluent/security/` — `roles.now.ts` (`Role` `x_1676196_rest_gui.user`, the `EXPLORER_ROLE`) and `properties.now.ts` (`Property` `x_1676196_rest_gui.default_mid_server`, the fallback MID server).
- `src/fluent/generated/keys.ts` — generated `Now.ID` key registry; do not hand-edit.

The SDK ships its own Fluent API docs under `node_modules/@servicenow/sdk/docs/` (`api/`, `guides/`) — consult those for `ScriptInclude` / `SPWidget` / `SPPage` / `Role` / `Property` signatures.

## The MID-server OAuth workaround

Implemented in `RestExplorerEngine._applyAuth` / `_getAccessToken`:
1. Fetch the token in script (`GlideOAuthClient.getToken`, refresh via `requestTokenByRequest` when `getExpiresIn() < 60`).
2. When MID-routed, route the **token request itself** through the MID server (`tokenRequest.setMIDServer`) — the token endpoint is usually behind the same firewall.
3. Inject `Authorization: Bearer <token>` manually **and** call `setAuthenticationProfile('no_authentication')` so the record's configured auth doesn't overwrite the header.

**`'no_authentication'` is not listed in the `setAuthenticationProfile` docs** (which cover only `'basic'` / `'oauth2'`), but it is selectable out-of-the-box as an authentication type on the instance. It is load-bearing; re-verify it after any platform upgrade.

MID-routed messages are always **asynchronous** — the engine switches to `executeAsync()` + `waitForResponse()` whenever a MID server is selected.

## Schema assumptions

The local docs cover the server APIs but **not** table schemas or Service Portal widget internals.

**Confirmed (Ben, 2026-07-18) — the REST message function child tables:**

- `sys_rest_message_fn_param_defs` = **defined HTTP query parameters**. ServiceNow does **not** enforce using this table — it may be empty even when the endpoint takes query params.
- `sys_rest_message_fn_parameters` = **variable substitutions** — the values substituted into `${token}` templates in the function endpoint (and body).

Two authoring patterns exist in the wild (both seen live on real records), and the engine must keep handling both:

1. Query params templated inline in the endpoint: `https://catfact.ninja/breeds?limit=${limit}`, with values supplied via variable substitutions (`fn_parameters`).
2. A bare endpoint with query params defined only as `param_defs` rows — and a `param_defs` row's **value can itself be a `${token}`** (seen live: `s=${symbol}` on a Yahoo Finance function). The engine resolves such tokens itself from the user's variables (`_substituteTokens`) rather than relying on the platform substituting into `setQueryParameter` values on a rebuilt transient message; unresolved tokens are left intact for the platform to try.

`_resolveFunction` covers both: it re-applies `param_defs` rows (ordered by their `order` column) via `setQueryParameter` on the rebuilt transient message and lets `${token}` substitution handle the rest. A single function can mix the two.

More `fn_parameters` details (from live records): its list columns are Name / **Escape type** / **Test value**, and the test-value column's element is **`value`** (confirmed live). The engine always substitutes with `setStringParameterNoEscape`, ignoring `escape_type` — fine for a console where the user sees the raw result, but revisit if faithful escaping ever matters.

**Still unverified on an instance:** `sys_rest_message_fn.function_name` / `.http_method` / `.rest_endpoint` / `.rest_message`, `sys_auth_profile_basic`, `ecc_agent.status=Up` for MID servers, and `sn_auth.OAuthMidSelector` (undocumented; wrapped in try/catch).

## What this project is

A Swagger-UI-like interface inside ServiceNow for exercising REST Messages and their HTTP methods:

- An auth dropdown: Basic, API key, OAuth.
- Selecting OAuth reveals an OAuth profile picker.
- A Script Include builds a RESTMessage with OAuth headers applied manually, so the call can still be routed through a MID Server.

See `README.md` for the full feature set and usage.

## The core constraint this project works around

The MID-server workaround is not a preference — it exists because the platform blocks the direct path. Per `markdown/api-reference/web-services/c_OutboundRESTAuth.md`:

> OAuth 2.0 can be used only with messages that are not configured to use a MID Server. You cannot send OAuth 2.0 authenticated messages through a MID Server.

Hence the manual approach: fetch a token yourself, then set it as a plain header on a MID-routed message rather than configuring the message's auth type as OAuth.

Verified API surface for that path (read these before writing against them):

- `sn_auth.GlideOAuthClient` — `getToken(requestID, oauthProfileID)`, `requestToken(clientName, jsonString)`, `requestTokenByRequest`, `revokeToken`. Global scripts may omit the `sn_auth` namespace. See `markdown/api-reference/server-api-reference/c_GlideOAuthClient.md`.
- `sn_ws.RESTMessageV2` — `setRequestHeader(name, value)` to attach `Authorization: Bearer …`, `setMIDServer(name)` to route. See `markdown/api-reference/server-api-reference/c_RESTMessageV2API.md`.
- **MID-routed REST messages are always asynchronous** — `executeAsync()` + `response.waitForResponse(seconds)`, not `execute()`. This changes the UI's response handling. See `markdown/api-reference/web-services/r_RESTMessageV2MIDServerExample.md`.

Other RESTMessageV2 limits relevant to the auth dropdown, from the same auth doc: mutual auth is unsupported over MID Server and unavailable with OAuth 2.0; custom/AWS auth algorithms are IntegrationHub REST Step only, not RESTMessageV2.

## ServiceNow documentation — consult before writing platform code

Local clone expected at `../ServiceNowDocs` (sibling of this repo; ~49k markdown files, Australia release family). **Reference it rather than recalling ServiceNow syntax, API names, or table names from memory.** Getting scoped-API namespaces and method signatures wrong is the main failure mode here, and the docs are authoritative.

Navigation notes (from that repo's own `AGENTS.md` / `llms.txt`):

- Content lives in `markdown/{publication}/…`; each publication has an `index.md` table of contents.
- Most relevant publications here: `api-reference/server-api-reference/` (scripted APIs) and `api-reference/web-services/` (outbound REST concepts and tasks).
- Default branch is `australia` (latest GA); there is no `main`. Other release families are separate branches (`zurich`, `yokohama`, `xanadu`).
- Do **not** scrape `servicenow.com/docs` — it's a JS SPA and returns nothing readable. The local markdown is the only source.
- That repo is generated and refreshed monthly; never edit its content files.

## Environment note

This directory is a git repository (default branch `main`). Node/now-sdk toolchain is installed; run `npm install` if `node_modules` is missing before building.
