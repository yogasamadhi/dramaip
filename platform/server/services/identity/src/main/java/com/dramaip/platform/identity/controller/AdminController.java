package com.dramaip.platform.identity.controller;

import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.identity.service.AdminService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {
    private final AdminService admin;
    public AdminController(AdminService admin) { this.admin = admin; }

    @PostMapping("/auth/login")
    public Result<AdminService.Login> login(@Valid @RequestBody LoginRequest request) { return Result.ok(admin.login(request.email(), request.password())); }
    @GetMapping("/me")
    public Result<AdminService.Principal> me(Authentication authentication) { return Result.ok(admin.require(authentication, "")); }
    @PostMapping("/confirmations")
    public ResponseEntity<Result<AdminService.Confirmation>> confirmation(Authentication authentication, @Valid @RequestBody ConfirmationRequest request) {
        AdminService.Principal actor = admin.require(authentication, null);
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.ok(admin.createConfirmation(actor, request.action(), request.targetId(), request.reason())));
    }
    @PostMapping("/confirmations/{confirmationId}/consume")
    public Result<AdminService.ConsumedConfirmation> consumeConfirmation(
            Authentication authentication, @PathVariable String confirmationId,
            @Valid @RequestBody ConsumeConfirmationRequest request) {
        return Result.ok(admin.consumeConfirmation(admin.require(authentication, null), confirmationId,
                request.action(), request.targetId()));
    }
    @PostMapping("/principals/{principalId}/suspend")
    public Result<AdminService.Principal> suspend(Authentication authentication, @PathVariable String principalId, @Valid @RequestBody SuspendRequest request) {
        return Result.ok(admin.suspend(admin.require(authentication, "principal.write"), principalId, request.confirmationId()));
    }
    @GetMapping("/audit")
    public Result<List<AdminService.AuditLog>> audit(Authentication authentication, @RequestParam(defaultValue = "50") int limit) {
        return Result.ok(admin.audit(admin.require(authentication, "audit.read"), limit));
    }

    public record LoginRequest(@NotBlank String email, @NotBlank String password) { }
    public record ConfirmationRequest(@NotBlank String action, @NotBlank String targetId, @NotBlank String reason) { }
    public record ConsumeConfirmationRequest(@NotBlank String action, @NotBlank String targetId) { }
    public record SuspendRequest(@NotBlank String confirmationId) { }
}
