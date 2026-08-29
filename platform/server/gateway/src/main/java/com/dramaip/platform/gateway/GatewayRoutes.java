package com.dramaip.platform.gateway;

import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The gateway only selects an owner; it never aggregates or rewrites a business response. */
@Configuration
class GatewayRoutes {
    @Bean
    RouteLocator dramaipRoutes(RouteLocatorBuilder builder) {
        return builder.routes()
                .route("billing-admin", r -> r.path("/api/v1/admin/billing/**").uri("lb://billing"))
                .route("quota-admin", r -> r.path("/api/v1/admin/quota/**").uri("lb://quota"))
                .route("ai-admin", r -> r.path("/api/v1/admin/ai/**").uri("lb://ai"))
                .route("creative-corpus-admin", r -> r.path("/api/v1/admin/creative-corpus/**").uri("lb://ai"))
                .route("notification-admin", r -> r.path("/api/v1/admin/notifications/**").uri("lb://notification"))
                .route("reporting-admin", r -> r.path("/api/v1/admin/reporting/**").uri("lb://reporting"))
                .route("identity", r -> r.path("/api/v1/auth/**", "/api/v1/users/**", "/api/v1/workspaces/**", "/api/v1/admin/**").uri("lb://identity"))
                .route("notification", r -> r.path("/api/v1/notifications/**").uri("lb://notification"))
                .route("reporting", r -> r.path("/api/v1/analytics/**", "/api/v1/reports/**").uri("lb://reporting"))
                .route("creation", r -> r.path("/api/v1/drafts/**", "/api/v1/project-snapshots/**", "/api/v1/upload-sessions/**", "/api/v1/review-packages/**").uri("lb://creation"))
                .route("quota", r -> r.path("/api/v1/quota/**").uri("lb://quota"))
                .route("ai", r -> r.path("/api/v1/models/**", "/api/v1/preflight/**", "/api/v1/chats/**", "/api/v1/stream/**", "/api/v1/cancel/**", "/api/v1/expansions/**", "/api/v1/cost-alerts/**", "/api/v1/inspiration-conversations/**", "/api/v1/inspiration-memories/**", "/api/v1/inspiration-project-previews/**", "/api/v1/creative-corpus/**", "/api/v1/creative-collections/**", "/api/v1/creative-fingerprint/**", "/api/v1/inspiration-experiments/**").uri("lb://ai"))
                .route("billing", r -> r.path("/api/v1/plans/**", "/api/v1/orders/**", "/api/v1/payments/**", "/api/v1/subscriptions/**", "/api/v1/refunds/**", "/api/v1/reconciliation/**", "/api/v1/payment-webhooks/**").uri("lb://billing"))
                .build();
    }
}
