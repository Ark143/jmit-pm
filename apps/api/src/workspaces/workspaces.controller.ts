import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AddMemberDto, CreateWorkspaceDto } from "./workspaces.dto";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.listForUser(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.userId, dto);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.get(user.userId, id);
  }

  @Get(":id/dashboard")
  dashboard(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.dashboard(user.userId, id);
  }

  @Post(":id/members")
  addMember(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AddMemberDto) {
    return this.workspaces.addMember(user.userId, id, dto);
  }

  @Delete(":id/members/:userId")
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
  ) {
    return this.workspaces.removeMember(user.userId, id, targetUserId);
  }
}
