package com.dramaip.platform.identity.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.dramaip.platform.common.web.BusinessException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class WorkspaceServiceSecurityTest {
    @Test
    void malformedInvitationInputsAreRejectedBeforeDatabaseAccess() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        WorkspaceService service = new WorkspaceService(jdbc);

        assertEquals("IDENTITY_INVALID_EMAIL", assertThrows(BusinessException.class,
                () -> service.invite("actor", "workspace",
                        new WorkspaceService.InviteCommand("not-an-email", "member", 72))).code());
        assertEquals("IDENTITY_WORKSPACE_ROLE_INVALID", assertThrows(BusinessException.class,
                () -> service.invite("actor", "workspace",
                        new WorkspaceService.InviteCommand("person@example.com", "owner", 72))).code());
        assertEquals("IDENTITY_INVITATION_EXPIRY_INVALID", assertThrows(BusinessException.class,
                () -> service.invite("actor", "workspace",
                        new WorkspaceService.InviteCommand("person@example.com", "member", 169))).code());
        assertEquals("IDENTITY_WORKSPACE_INVITATION_INVALID", assertThrows(BusinessException.class,
                () -> service.acceptInvitation("user", "plaintext-or-malformed")).code());

        verifyNoInteractions(jdbc);
    }
}
