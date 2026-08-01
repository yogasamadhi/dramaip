package com.dramaip.platform.identity.service;

import com.dramaip.platform.common.web.BusinessException;
import com.dramaip.platform.identity.IdentityJwtProperties;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.stereotype.Service;

@Service
public class TokenService {
    private final IdentityJwtProperties properties;
    private final RSAKey signingKey;
    private final JwtEncoder encoder;

    public TokenService(IdentityJwtProperties properties) {
        this.properties = properties;
        this.signingKey = signingKey(properties);
        this.encoder = new org.springframework.security.oauth2.jwt.NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(signingKey)));
    }

    public String accessToken(String userId, String email) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer(properties.getIssuer()).subject(userId).audience(List.of(properties.getAudience()))
                .issuedAt(now).expiresAt(now.plusSeconds(properties.getAccessTtlSeconds())).id(UUID.randomUUID().toString()).claim("email", email).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId(properties.getKeyId()).build(), claims)).getTokenValue();
    }

    /** Admin sessions use the same rotation-capable key but are unambiguously marked and checked against admin.sessions. */
    public AdminAccessToken adminAccessToken(String principalId, String email, List<String> roles) {
        Instant now = Instant.now();
        String tokenId = UUID.randomUUID().toString();
        Instant expiresAt = now.plusSeconds(properties.getAccessTtlSeconds());
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer(properties.getIssuer()).subject(principalId).audience(List.of(properties.getAudience()))
                .issuedAt(now).expiresAt(expiresAt).id(tokenId).claim("email", email).claim("actorType", "admin").claim("roles", roles).build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).keyId(properties.getKeyId()).build(), claims)).getTokenValue();
        return new AdminAccessToken(token, tokenId, expiresAt);
    }

    public String jwks() { return new JWKSet(signingKey.toPublicJWK()).toString(); }

    private RSAKey signingKey(IdentityJwtProperties values) {
        try {
            KeyPair pair = values.getPrivateKeyPem().isBlank() ? ephemeral(values) : readPair(values.getPrivateKeyPem());
            return new RSAKey.Builder((RSAPublicKey) pair.getPublic()).privateKey((RSAPrivateKey) pair.getPrivate()).keyID(values.getKeyId()).build();
        } catch (Exception exception) {
            throw new BusinessException("IDENTITY_SIGNING_KEY_INVALID", "RS256 signing key cannot be loaded", HttpStatus.SERVICE_UNAVAILABLE);
        }
    }

    private KeyPair ephemeral(IdentityJwtProperties values) throws Exception {
        if (!values.isAllowEphemeralKey()) throw new IllegalStateException("IDENTITY_JWT_PRIVATE_KEY_PEM is required outside local development");
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(3072);
        return generator.generateKeyPair();
    }

    private KeyPair readPair(String pem) throws Exception {
        String raw = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", "");
        RSAPrivateCrtKey privateKey = (RSAPrivateCrtKey) KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(raw.getBytes(StandardCharsets.US_ASCII))));
        RSAPublicKey publicKey = (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(privateKey.getModulus(), privateKey.getPublicExponent()));
        return new KeyPair(publicKey, privateKey);
    }
    public record AdminAccessToken(String token, String tokenId, Instant expiresAt) { }
}
