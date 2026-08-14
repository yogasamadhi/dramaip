package com.dramaip.platform.gateway;

import com.dramaip.platform.common.observability.DramaipMetrics;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Import;

@SpringBootApplication
@EnableConfigurationProperties({GatewayJwtProperties.class, GatewayCorsProperties.class})
@Import(DramaipMetrics.class)
public class GatewayApplication {
    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
