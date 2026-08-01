package com.dramaip.platform.creation;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.dramaip.platform.creation", "com.dramaip.platform.common"})
@EnableFeignClients(basePackages = "com.dramaip.platform.creation")
@EnableScheduling
public class CreationApplication {
    public static void main(String[] args) { SpringApplication.run(CreationApplication.class, args); }
}
