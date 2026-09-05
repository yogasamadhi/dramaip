package com.dramaip.platform.identity.controller;

import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.identity.service.WorkspaceService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class WorkspaceController {
    private final WorkspaceService workspaces;

    public WorkspaceController(WorkspaceService workspaces) {
        this.workspaces = workspaces;
    }

    @GetMapping("/api/v1/workspaces")
    public Result<List<WorkspaceService.Workspace>> workspaces(Authentication authentication) {
        return Result.ok(workspaces.workspaces(CurrentUser.id(authentication)));
    }

    @GetMapping("/api/v1/workspaces/{workspaceId}/members")
    public Result<List<WorkspaceService.Member>> members(Authentication authentication, @PathVariable String workspaceId) {
        return Result.ok(workspaces.members(CurrentUser.id(authentication), workspaceId));
    }

    @PatchMapping("/api/v1/workspaces/{workspaceId}/members/{memberId}")
    public Result<WorkspaceService.Member> updateMember(Authentication authentication, @PathVariable String workspaceId,
            @PathVariable String memberId, @Valid @RequestBody UpdateMemberRequest request) {
        return Result.ok(workspaces.updateMember(CurrentUser.id(authentication), workspaceId, memberId, request.role()));
    }

    @DeleteMapping("/api/v1/workspaces/{workspaceId}/members/{memberId}")
    public Result<WorkspaceService.Member> removeMember(Authentication authentication, @PathVariable String workspaceId,
            @PathVariable String memberId) {
        return Result.ok(workspaces.removeMember(CurrentUser.id(authentication), workspaceId, memberId));
    }

    @GetMapping("/api/v1/workspaces/{workspaceId}/invitations")
    public Result<List<WorkspaceService.Invitation>> invitations(Authentication authentication, @PathVariable String workspaceId) {
        return Result.ok(workspaces.invitations(CurrentUser.id(authentication), workspaceId));
    }

    @PostMapping("/api/v1/workspaces/{workspaceId}/invitations")
    public Result<WorkspaceService.Invitation> invite(Authentication authentication, @PathVariable String workspaceId,
            @Valid @RequestBody InviteRequest request) {
        return Result.ok(workspaces.invite(CurrentUser.id(authentication), workspaceId,
                new WorkspaceService.InviteCommand(request.email(), request.role(), request.expiresInHours())));
    }

    @DeleteMapping("/api/v1/workspaces/{workspaceId}/invitations/{invitationId}")
    public Result<WorkspaceService.Invitation> revokeInvitation(Authentication authentication, @PathVariable String workspaceId,
            @PathVariable String invitationId) {
        return Result.ok(workspaces.revokeInvitation(CurrentUser.id(authentication), workspaceId, invitationId));
    }

    @PostMapping("/api/v1/workspace-invitations/{token}/accept")
    public Result<WorkspaceService.Member> acceptInvitation(Authentication authentication, @PathVariable String token) {
        return Result.ok(workspaces.acceptInvitation(CurrentUser.id(authentication), token));
    }

    public record UpdateMemberRequest(@NotBlank String role) { }
    public record InviteRequest(@NotBlank @Email String email, @NotBlank String role,
                                @Min(1) @Max(168) Integer expiresInHours) { }
}
