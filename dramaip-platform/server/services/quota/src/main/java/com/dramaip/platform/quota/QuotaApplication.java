package com.dramaip.platform.quota;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.dramaip.platform.quota", "com.dramaip.platform.common"})
@EnableFeignClients(basePackages = "com.dramaip.platform.quota")
@EnableScheduling
public class QuotaApplication {
    public static void main(String[] args) { SpringApplication.run(QuotaApplication.class, args); }
}
