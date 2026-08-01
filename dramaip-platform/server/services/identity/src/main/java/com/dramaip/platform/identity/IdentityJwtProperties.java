package com.dramaip.platform.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dramaip.identity.jwt")
public class IdentityJwtProperties {
    private String privateKeyPem = "";
    private String keyId = "dramaip-current";
    private String issuer = "dramaip-identity";
    private String audience = "dramaip-clients";
    private long accessTtlSeconds = 900;
    private long refreshTtlSeconds = 2_592_000;
    private boolean allowEphemeralKey;
    public String getPrivateKeyPem() { return privateKeyPem; }
    public void setPrivateKeyPem(String privateKeyPem) { this.privateKeyPem = privateKeyPem; }
    public String getKeyId() { return keyId; }
    public void setKeyId(String keyId) { this.keyId = keyId; }
    public String getIssuer() { return issuer; }
    public void setIssuer(String issuer) { this.issuer = issuer; }
    public String getAudience() { return audience; }
    public void setAudience(String audience) { this.audience = audience; }
    public long getAccessTtlSeconds() { return accessTtlSeconds; }
    public void setAccessTtlSeconds(long accessTtlSeconds) { this.accessTtlSeconds = accessTtlSeconds; }
    public long getRefreshTtlSeconds() { return refreshTtlSeconds; }
    public void setRefreshTtlSeconds(long refreshTtlSeconds) { this.refreshTtlSeconds = refreshTtlSeconds; }
    public boolean isAllowEphemeralKey() { return allowEphemeralKey; }
    public void setAllowEphemeralKey(boolean allowEphemeralKey) { this.allowEphemeralKey = allowEphemeralKey; }
}
