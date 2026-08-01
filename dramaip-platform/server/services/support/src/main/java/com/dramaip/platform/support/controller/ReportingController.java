package com.dramaip.platform.support.controller;

import com.dramaip.platform.common.security.AdminAccess;
import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.support.service.ReportingService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ReportingController {
    private final ReportingService reporting;
    public ReportingController(ReportingService reporting) { this.reporting = reporting; }

    @GetMapping("/reports/me")
    public Result<ReportingService.UserReport> report(Authentication authentication, @RequestParam(defaultValue = "20") int limit) {
        return Result.ok(reporting.reportFor(CurrentUser.id(authentication), limit));
    }

    @GetMapping("/analytics/usage")
    public Result<ReportingService.UsageSummary> usage(Authentication authentication) {
        return Result.ok(reporting.reportFor(CurrentUser.id(authentication), 1).usage());
    }

    @GetMapping("/admin/reporting/overview")
    public Result<ReportingService.AdminOverview> overview(Authentication authentication) {
        AdminAccess.require(authentication, "audit.read");
        return Result.ok(reporting.adminOverview());
    }

    @GetMapping("/admin/reporting/users")
    public Result<ReportingService.AdminUsers> users(
            Authentication authentication,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "") String query) {
        AdminAccess.require(authentication, "audit.read");
        return Result.ok(reporting.adminUsers(limit, cursor, query));
    }

    @GetMapping("/admin/reporting/orders")
    public Result<ReportingService.AdminOrders> orders(
            Authentication authentication,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "") String query) {
        AdminAccess.require(authentication, "audit.read");
        return Result.ok(reporting.adminOrders(limit, cursor, query));
    }

    @GetMapping("/admin/reporting/subscriptions")
    public Result<ReportingService.AdminSubscriptions> subscriptions(
            Authentication authentication,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "") String query) {
        AdminAccess.require(authentication, "audit.read");
        return Result.ok(reporting.adminSubscriptions(limit, cursor, query));
    }

    @GetMapping("/admin/reporting/exceptions")
    public Result<ReportingService.AdminExceptions> exceptions(
            Authentication authentication,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(name = "include_resolved", defaultValue = "false") boolean includeResolved,
            @RequestParam(defaultValue = "") String cursor,
            @RequestParam(defaultValue = "") String query) {
        AdminAccess.require(authentication, "audit.read");
        return Result.ok(reporting.adminExceptions(limit, includeResolved, cursor, query));
    }
}
