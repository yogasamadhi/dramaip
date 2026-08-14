package com.dramaip.platform.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "dramaip.ai")
public class AiProperties {
    private String baseUrl = "";
    private String apiKey = "";
    private String models = "";
    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public String getModels() { return models; }
    public void setModels(String models) { this.models = models; }
}
