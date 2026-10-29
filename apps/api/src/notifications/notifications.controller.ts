import { Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("workspaceId") workspaceId: string) {
    return this.notifications.list(user.userId, workspaceId);
  }

  @Post("read-all")
  readAll(@CurrentUser() user: AuthUser, @Query("workspaceId") workspaceId?: string) {
    return this.notifications.markAllRead(user.userId, workspaceId);
  }

  @Patch(":id/read")
  read(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.notifications.markRead(user.userId, id);
  }
}
