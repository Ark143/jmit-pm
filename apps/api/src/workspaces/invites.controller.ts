import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateInviteDto } from "./workspaces.dto";
import { WorkspacesService } from "./workspaces.service";

/**
 * Join links have to be readable before sign-in, so preview lives outside the
 * guard and the remaining routes opt in one by one.
 */
@Controller()
export class InvitesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get("invites/:token")
  preview(@Param("token") token: string) {
    return this.workspaces.previewInvite(token);
  }

  @Post("invites/:token/accept")
  @UseGuards(JwtAuthGuard)
  accept(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    return this.workspaces.acceptInvite(user.userId, token);
  }

  @Get("workspaces/:id/invites")
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.listInvites(user.userId, id);
  }

  @Post("workspaces/:id/invites")
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CreateInviteDto) {
    return this.workspaces.createInvite(user.userId, id, dto);
  }

  @Delete("invites/:inviteId")
  @UseGuards(JwtAuthGuard)
  revoke(@CurrentUser() user: AuthUser, @Param("inviteId") inviteId: string) {
    return this.workspaces.revokeInvite(user.userId, inviteId);
  }
}
