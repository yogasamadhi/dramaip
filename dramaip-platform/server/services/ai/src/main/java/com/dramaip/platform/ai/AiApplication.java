package com.dramaip.platform.ai;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication(scanBasePackages = {"com.dramaip.platform.ai", "com.dramaip.platform.common"})
@EnableFeignClients(basePackages = "com.dramaip.platform.ai")
@EnableConfigurationProperties(AiProperties.class)
public class AiApplication {
    public static void main(String[] args) { SpringApplication.run(AiApplication.class, args); }
}
