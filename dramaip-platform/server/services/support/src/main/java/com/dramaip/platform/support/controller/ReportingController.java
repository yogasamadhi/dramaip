package com.dramaip.platform.support.controller;

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
}
