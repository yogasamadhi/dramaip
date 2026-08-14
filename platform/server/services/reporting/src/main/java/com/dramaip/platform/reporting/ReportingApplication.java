package com.dramaip.platform.reporting;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication(scanBasePackages = {"com.dramaip.platform.reporting", "com.dramaip.platform.common"})
@EnableFeignClients(basePackages = "com.dramaip.platform.reporting")
public class ReportingApplication {
    public static void main(String[] args) { SpringApplication.run(ReportingApplication.class, args); }
}
