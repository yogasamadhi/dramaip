# Public client contracts

## v1 baseline

The public HTTP boundary for Web, Mobile, Admin and Desktop is versioned with
`X-DramaIP-Contract-Version`. Shipped v1 clients send `1`; every BFF response
returns the supported version in the same header.

- The authority for v1 common limits and error shape is
  [`clients/packages/sdk/contracts/http-v1.schema.json`](../clients/packages/sdk/contracts/http-v1.schema.json).
- Runtime schemas and typed models live in
  [`clients/packages/sdk/src/contracts.ts`](../clients/packages/sdk/src/contracts.ts).
- List requests accept `limit` from 1 to 100. Web usage trends accept `days`
  from 1 to 365. Servers validate these values; they are never silently
  replaced by a hard-coded value.
- All public BFF failures use
  `{ "error": { "code", "message", "trace_id" } }`. The response also carries
  `X-DramaIP-Trace-Id` for support correlation.
- Desktop receives only cloud account, models, preflight, chat and mobile
  handoff models. It must not depend on platform internal/core domain types.
- Web authoring uses the server model catalog, then calls preflight for the
  final messages before opening `/v1/ai/chat/stream`. `Idempotency-Key` is an
  opaque recovery key: it is never shown as product UI. A disconnect may query
  `/v1/ai/chat/status` with that same key and must not submit a second model
  request. `/cancel` releases a reserved generation before it is persisted as
  canceled. SSE failures carry a `trace_id`; prompts and provider credentials
  never appear in the catalog, status or audit response.

## Compatibility and deprecation

An omitted request header remains accepted for the v1 migration window so
already released applications do not break. A client that explicitly sends an
unsupported version receives HTTP 426 and `contract_version_unsupported`.

Breaking changes must introduce `/v2` routes and a new `v2` schema. Keep v1
available for at least two released desktop/mobile versions and 90 days after
the first v2 production release; announce the retirement date in release
notes before removing it. Additive fields stay optional in the current
version.

`pnpm contracts:check` is the CI gate. When it can inspect `origin/main`, any
change to the published schema without a contract-version bump fails the gate.
The command also verifies that Admin and Mobile parse key responses through
the shared schemas and that each public client declares the version header.
