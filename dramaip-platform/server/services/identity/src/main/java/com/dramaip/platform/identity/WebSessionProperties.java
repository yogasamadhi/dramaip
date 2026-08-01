package com.dramaip.platform.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;
import java.time.Duration;

/** Settings for browser-only sessions; native clients use bearer tokens instead. */
@ConfigurationProperties(prefix = "dramaip.identity.web-session")
public class WebSessionProperties {
    private boolean secure;
    private String cookieDomain = "";
    private Duration refreshTtl = Duration.ofDays(30);

    public boolean isSecure() { return secure; }
    public void setSecure(boolean secure) { this.secure = secure; }
    public String getCookieDomain() { return cookieDomain; }
    public void setCookieDomain(String cookieDomain) { this.cookieDomain = cookieDomain == null ? "" : cookieDomain.trim(); }
    public Duration getRefreshTtl() { return refreshTtl; }
    public void setRefreshTtl(Duration refreshTtl) { this.refreshTtl = refreshTtl == null ? Duration.ofDays(30) : refreshTtl; }
}
