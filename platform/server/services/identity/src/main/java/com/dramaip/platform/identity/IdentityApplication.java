package com.dramaip.platform.identity;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication(scanBasePackages = {"com.dramaip.platform.identity", "com.dramaip.platform.common"})
@EnableFeignClients(basePackages = "com.dramaip.platform.identity")
@EnableConfigurationProperties({IdentityJwtProperties.class, WebSessionProperties.class})
public class IdentityApplication {
    public static void main(String[] args) { SpringApplication.run(IdentityApplication.class, args); }
}
