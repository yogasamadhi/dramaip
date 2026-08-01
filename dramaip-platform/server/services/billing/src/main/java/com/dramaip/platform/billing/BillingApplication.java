package com.dramaip.platform.billing;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication(scanBasePackages = {"com.dramaip.platform.billing", "com.dramaip.platform.common"})
@EnableFeignClients(basePackages = "com.dramaip.platform.billing")
public class BillingApplication {
    public static void main(String[] args) { SpringApplication.run(BillingApplication.class, args); }
}
