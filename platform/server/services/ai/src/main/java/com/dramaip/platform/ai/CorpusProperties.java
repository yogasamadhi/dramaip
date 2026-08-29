package com.dramaip.platform.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dramaip.corpus")
public class CorpusProperties {
    private boolean crawlerEnabled;
    private boolean publicSearchEnabled;
    private boolean personalizationEnabled;
    private boolean experimentsEnabled;
    private int maxBytes = 2_097_152;
    private int maxRedirects = 5;
    private int maxDepth = 2;
    private long minimumDomainDelayMs = 1_000;
    private String userAgent = "DramaIP-Creative-Corpus/1.0 (+https://dramaip.example/corpus-policy)";
    private String encryptionKeyBase64 = "";
    private String encryptionKeyVersion = "v1";
    private String snapshotPrivateKeyPem = "";

    public boolean isCrawlerEnabled() { return crawlerEnabled; }
    public void setCrawlerEnabled(boolean crawlerEnabled) { this.crawlerEnabled = crawlerEnabled; }
    public boolean isPublicSearchEnabled() { return publicSearchEnabled; }
    public void setPublicSearchEnabled(boolean publicSearchEnabled) { this.publicSearchEnabled = publicSearchEnabled; }
    public boolean isPersonalizationEnabled() { return personalizationEnabled; }
    public void setPersonalizationEnabled(boolean personalizationEnabled) { this.personalizationEnabled = personalizationEnabled; }
    public boolean isExperimentsEnabled() { return experimentsEnabled; }
    public void setExperimentsEnabled(boolean experimentsEnabled) { this.experimentsEnabled = experimentsEnabled; }
    public int getMaxBytes() { return maxBytes; }
    public void setMaxBytes(int maxBytes) { this.maxBytes = maxBytes; }
    public int getMaxRedirects() { return maxRedirects; }
    public void setMaxRedirects(int maxRedirects) { this.maxRedirects = maxRedirects; }
    public int getMaxDepth() { return maxDepth; }
    public void setMaxDepth(int maxDepth) { this.maxDepth = maxDepth; }
    public long getMinimumDomainDelayMs() { return minimumDomainDelayMs; }
    public void setMinimumDomainDelayMs(long minimumDomainDelayMs) { this.minimumDomainDelayMs = minimumDomainDelayMs; }
    public String getUserAgent() { return userAgent; }
    public void setUserAgent(String userAgent) { this.userAgent = userAgent; }
    public String getEncryptionKeyBase64() { return encryptionKeyBase64; }
    public void setEncryptionKeyBase64(String encryptionKeyBase64) { this.encryptionKeyBase64 = encryptionKeyBase64; }
    public String getEncryptionKeyVersion() { return encryptionKeyVersion; }
    public void setEncryptionKeyVersion(String encryptionKeyVersion) { this.encryptionKeyVersion = encryptionKeyVersion; }
    public String getSnapshotPrivateKeyPem() { return snapshotPrivateKeyPem; }
    public void setSnapshotPrivateKeyPem(String snapshotPrivateKeyPem) { this.snapshotPrivateKeyPem = snapshotPrivateKeyPem; }
}
