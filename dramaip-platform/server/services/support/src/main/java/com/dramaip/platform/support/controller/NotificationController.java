package com.dramaip.platform.support.controller;

import com.dramaip.platform.common.security.CurrentUser;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.support.service.NotificationService;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {
    private final NotificationService notifications;
    public NotificationController(NotificationService notifications) { this.notifications = notifications; }

    @GetMapping
    public Result<List<NotificationService.Notification>> list(Authentication authentication, @RequestParam(defaultValue = "50") int limit) {
        return Result.ok(notifications.list(CurrentUser.id(authentication), limit));
    }

    @PostMapping("/{notificationId}/read")
    public Result<NotificationService.Notification> markRead(Authentication authentication, @PathVariable String notificationId) {
        return Result.ok(notifications.markRead(CurrentUser.id(authentication), notificationId));
    }
}
