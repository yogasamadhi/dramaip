# Public client contracts

These contracts cover optional Platform cloud APIs under [product positioning](../../docs/product/POSITIONING.md), not the independent Desktop Core Runtime `/api/v2` boundary. Novel writing can produce manuscripts without adaptation or media, and cloud calls do not authorize automatic synchronization of private drafts. Product goals do not change existing protocol/version ownership or prove new workflow implementation.

## Contract 2

The public HTTP boundary for Web, Mobile, Admin and Desktop is `/api/v1/**`
and requires `X-DramaIP-Contract-Version: 2`. Responses use the common
`Result<T>` envelope and return the request and trace identifiers for support.

- The authority for common limits and error shape is
  [`clients/packages/sdk/contracts/http-v2.schema.json`](../clients/packages/sdk/contracts/http-v2.schema.json).
- Runtime schemas and typed models live in
  [`clients/packages/sdk/src/contracts.ts`](../clients/packages/sdk/src/contracts.ts).
- List requests accept `limit` from 1 to 100. Web usage trends accept `days`
  from 1 to 365. Servers validate these values; they are never silently
  replaced by a hard-coded value.
- Public failures use `Result<T>` with `code`, `message`, `requestId` and
  `traceId` for support correlation.
- Desktop receives only cloud account, models, preflight, chat and mobile
  handoff models. It must not depend on platform internal/core domain types.
- Web authoring uses the server model catalog, then calls preflight for the
  final messages before opening `/api/v1/stream`. `Idempotency-Key` is an
  opaque recovery key: it is never shown as product UI. A disconnect may query
  `/api/v1/chats/status` with that same key and must not submit a second model
  request. `/cancel` releases a reserved generation before it is persisted as
  canceled. SSE failures carry a `trace_id`; prompts and provider credentials
  never appear in the catalog, status or audit response.

## Compatibility and deprecation

A request without the required contract header receives HTTP 426 and
`COMMON_CONTRACT_VERSION_UNSUPPORTED`. Breaking changes require a new
versioned contract; additive fields stay optional in the current version.

`pnpm run contracts:check` is the CI gate. When it can inspect `origin/main`, any
change to the published schema without a contract-version bump fails the gate.
The command also verifies that Admin and Mobile parse key responses through
the shared schemas and that each public client declares the version header.
