# Kong RS256 configuration

`kong.yml` is the checked-in development template. Authentication is still
enforced by the Web BFF calling auth-service, so local development does not
need a long-lived signing key or a static Kong credential.
The template also exposes the public `GET /.well-known/jwks.json` endpoint;
it never routes token issuance directly to auth-service.

The checked-in CORS entries are intentionally development-only origins and
allow credentials for the Web BFF's HttpOnly cookie session. Before production
deployment, replace them with the exact HTTPS web origin(s); never combine
`credentials: true` with a wildcard origin.

Prefer serving the Web app and Kong API from one public origin so Cookies remain
host-only. If controlled subdomains are required, configure `WEB_COOKIE_DOMAIN`
to their common parent domain; do not use it when any sibling subdomain is
untrusted, because browsers will then send the Cookie to that sibling.

The production renderer configures Kong JWT extraction from the
`dramaip_web_access` HttpOnly Cookie and bypasses JWT verification only for
CORS preflight. The BFF still verifies issuer, audience, and Redis session
state after Kong's signature/expiry checks.

`/v1/admin/...` is deliberately not part of that C-end credential set. The
Admin BFF verifies its own `ADMIN_JWT_ISSUER` / `ADMIN_JWT_AUDIENCE`, short
server-side admin session and independently mounted RSA key set. Production
operators must mount the matching public/admin JWKS in Kong before adding an
edge JWT plugin for this route; never point the Admin route at the Web JWT
credentials or accept the Web Cookie as a fallback.

Kong also removes every externally supplied `X-User-*` identity header before
proxying. The Web BFF derives user context from the verified session and
propagates it only on authenticated internal gRPC calls; downstream services do
not treat browser headers as an identity source.

Before a production rollout, mount the auth-service **public** JWKS file (the
same file configured as `JWT_JWKS_FILE`) on the release host, then render a
Kong declaration containing the active and retained RS256 public keys:

```bash
cd dramaip-platform/legacy/go-services
go run ./cmd/kong-jwt-config \
  -template ../deploy/kong/kong.yml \
  -jwks /secure/auth/jwks.json \
  -out /secure/kong/kong.production.yml
```

Configure Kong with the resulting `kong.production.yml`. The renderer accepts
only RSA 2048-bit-or-stronger `RS256` JWKs and writes only their PEM public
keys. It creates one credential per `kid`, so current and retained keys are
valid during the rotation window.

The generated Kong plugin validates `kid`, `exp`, and `nbf`. Kong's built-in
JWT plugin does not validate application-specific issuer or audience claims;
the protected Web BFF independently calls auth-service, which requires the
configured issuer and audience and checks the Redis session. Keep that second
check enabled.

Rotation order:

1. Add the next public key to `jwks.json` while retaining the current key.
2. Render and reload Kong, then deploy auth-service with the new private key
   and matching `JWT_ACTIVE_KID`.
3. Wait until all tokens signed by the retired key have expired, remove that
   public key, render, and reload Kong again.

Never add a private PEM, shared HMAC secret, or generated production Kong
configuration to Git.
