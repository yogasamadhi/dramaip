# Kong RS256 configuration

`kong.yml` is the checked-in development template. Authentication is still
enforced by the Web BFF calling auth-service, so local development does not
need a long-lived signing key or a static Kong credential.
The template also exposes the public `GET /.well-known/jwks.json` endpoint;
it never routes token issuance directly to auth-service.

Before a production rollout, mount the auth-service **public** JWKS file (the
same file configured as `JWT_JWKS_FILE`) on the release host, then render a
Kong declaration containing the active and retained RS256 public keys:

```bash
cd dramaip-platform/services
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
