# Free public APIs for validating the auth types

Endpoints for live-verifying each auth path in `RestExplorerEngine` without standing up your own
service. All of them were confirmed working on 2026-07-18; none require signup. Create a REST
Message (or use direct-URL mode) pointing at these, then exercise each auth type from the console.

They are all on the public internet, so they validate the **auth logic** but not MID-server
routing. To exercise the async `executeAsync()`/`waitForResponse()` path, route these same calls
through a MID server — but the OAuth-through-MID workaround itself still needs an endpoint that is
actually behind the MID server's firewall to be proven end to end.

## OAuth 2.0 — Duende IdentityServer demo

A real public OAuth 2.0 server (<https://demo.duendesoftware.com>), not just a header echo — it
issues JWTs and rejects calls to its API without a valid one. This is the endpoint pair for
verifying `_getAccessToken` → manual `Authorization: Bearer` header → protected resource.

| | |
|---|---|
| Token endpoint | `https://demo.duendesoftware.com/connect/token` |
| Grant | `client_credentials` |
| Client / secret | `m2m` / `secret` (1-hour tokens) |
| Short-lived client | `m2m.short` / `secret` (**75-second** tokens) |
| Scope | `api` |
| Protected API | `https://demo.duendesoftware.com/api/test` — echoes the token's claims; `401` without a valid Bearer token |
| Discovery | `https://demo.duendesoftware.com/.well-known/openid-configuration` |

Instance setup: create an OAuth Entity Profile whose provider points at the token endpoint above
with the `m2m` credentials, then select it in the console's OAuth dropdown against a REST Message
targeting `/api/test`.

Use `m2m.short` to exercise the refresh branch (`getExpiresIn() < 60` in `_getAccessToken`):
its 75-second tokens fall under the 60-second threshold almost immediately, so a second Send
should trigger `requestTokenByRequest` rather than reusing the cached token.

Sanity check from a shell:

```sh
curl -s -X POST https://demo.duendesoftware.com/connect/token \
  -d "grant_type=client_credentials&client_id=m2m&client_secret=secret&scope=api"
curl -s -H "Authorization: Bearer <access_token>" https://demo.duendesoftware.com/api/test
```

## Basic auth — httpbingo.org

`https://httpbingo.org/basic-auth/{user}/{pass}` — pick any username/password pair; the endpoint
returns `200` with `"authenticated": true` only when the credentials sent match the ones in the
URL, `401` otherwise. Point a Basic Auth profile (or the console's manual basic fields) at it.

httpbin.org has the same API but is frequently down (it was returning 503 when these were
verified); httpbingo.org is a maintained mirror. `postman-echo.com/basic-auth` also works, with
fixed credentials `postman` / `password`.

## API key — api.nasa.gov

`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY` — the shared `DEMO_KEY` works without
signup and genuinely validates: a wrong key gets `403`. This covers the **query-param** API key
mode. It is rate-limited (~30 req/hour on `DEMO_KEY`); a personal key is free if that becomes a
problem.

For the **header** API key mode there is no free validator, so use a header echo instead (below)
and confirm the key header arrives with the right name and value.

## Header echo — verifying what actually went on the wire

- `https://httpbingo.org/bearer` — returns `200` and echoes the token if an `Authorization:
  Bearer …` header arrived, `401` if not. The quickest check that manual header injection isn't
  producing `Bearer undefined`.
- `https://postman-echo.com/headers` — echoes back every request header. Useful for confirming
  exactly what `RESTMessageV2` sent after `setAuthenticationProfile('no_authentication')`, and for
  inspecting header-mode API keys.
