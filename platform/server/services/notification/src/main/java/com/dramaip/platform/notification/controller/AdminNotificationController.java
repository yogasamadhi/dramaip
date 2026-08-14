package com.dramaip.platform.notification.controller;

import com.dramaip.platform.common.security.AdminAccess;
import com.dramaip.platform.common.web.Result;
import com.dramaip.platform.notification.service.NotificationService;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/notifications")
public class AdminNotificationController {
    private final NotificationService notifications;
    public AdminNotificationController(NotificationService notifications) { this.notifications = notifications; }

    @GetMapping("/delivery-attempts")
    public Result<AdminDeliveryAttempts> deliveryAttempts(
            Authentication authentication,
            @RequestParam(defaultValue = "failed") String status,
            @RequestParam(defaultValue = "50") int limit) {
        AdminAccess.require(authentication, "notification.write");
        return Result.ok(new AdminDeliveryAttempts(notifications.deliveryAttempts(status, limit)));
    }

    public record AdminDeliveryAttempts(List<NotificationService.DeliveryAttempt> attempts) { }
}
