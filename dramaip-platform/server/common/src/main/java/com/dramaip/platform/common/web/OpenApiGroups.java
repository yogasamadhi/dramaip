package com.dramaip.platform.common.web;

import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Every service publishes independently versioned public and internal OpenAPI descriptions. */
@Configuration
public class OpenApiGroups {
    @Bean
    GroupedOpenApi publicApi() {
        return GroupedOpenApi.builder().group("public").pathsToMatch("/api/**").build();
    }

    @Bean
    GroupedOpenApi internalApi() {
        return GroupedOpenApi.builder().group("internal").pathsToMatch("/internal/**").build();
    }
}
