package com.dramaip.platform.identity.controller;

import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.identity.service.ProfileService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {
    private final ProfileService profiles;
    public UserController(ProfileService profiles) { this.profiles = profiles; }

    @GetMapping("/api/v1/users/me/profile")
    public Result<ProfileService.Profile> profile(Authentication authentication) { return Result.ok(profiles.profile(CurrentUser.id(authentication))); }

    @PatchMapping("/api/v1/users/me/profile")
    public Result<ProfileService.Profile> update(Authentication authentication, @Valid @RequestBody UpdateProfileRequest request) {
        return Result.ok(profiles.update(CurrentUser.id(authentication), new ProfileService.UpdateProfile(request.displayName(), request.avatarUrl(), request.locale(), request.timezone())));
    }

    @GetMapping("/internal/v1/workspaces/{workspaceId}/me")
    public Result<ProfileService.Workspace> currentWorkspace(Authentication authentication, @PathVariable String workspaceId) {
        return Result.ok(profiles.workspace(CurrentUser.id(authentication), workspaceId));
    }

    /** Composite context lives in identity; other domain sections are progressively supplied by controlled Feign reads. */
    @GetMapping("/api/v1/users/me/context")
    public Result<Map<String, Object>> context(Authentication authentication) {
        String userId = CurrentUser.id(authentication);
        return Result.ok(Map.of("profile", profiles.profile(userId), "workspaces", profiles.workspaces(userId)));
    }

    public record UpdateProfileRequest(@NotBlank String displayName, String avatarUrl, String locale, String timezone) { }
}
