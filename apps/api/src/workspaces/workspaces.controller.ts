import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  AddMemberDto,
  CreateFilterDto,
  CreateTagDto,
  CreateWorkspaceDto,
  UpdateFilterDto,
} from "./workspaces.dto";
import { WorkspacesService } from "./workspaces.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get("workspaces")
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.listForUser(user.userId);
  }

  @Post("workspaces")
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.userId, dto);
  }

  @Get("workspaces/:id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.get(user.userId, id);
  }

  @Get("workspaces/:id/dashboard")
  dashboard(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.dashboard(user.userId, id);
  }

  @Get("workspaces/:id/search")
  search(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("q") q = "",
  ) {
    return this.workspaces.search(user.userId, id, q);
  }

  @Get("workspaces/:id/workload")
  workload(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("days") days = "14",
  ) {
    return this.workspaces.workload(user.userId, id, days);
  }

  @Post("workspaces/:id/members")
  addMember(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AddMemberDto) {
    return this.workspaces.addMember(user.userId, id, dto);
  }

  @Delete("workspaces/:id/members/:userId")
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
  ) {
    return this.workspaces.removeMember(user.userId, id, targetUserId);
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  @Get("workspaces/:id/tags")
  listTags(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.workspaces.listTags(user.userId, id);
  }

  @Post("workspaces/:id/tags")
  createTag(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CreateTagDto) {
    return this.workspaces.createTag(user.userId, id, dto);
  }

  @Delete("tags/:tagId")
  removeTag(@CurrentUser() user: AuthUser, @Param("tagId") tagId: string) {
    return this.workspaces.removeTag(user.userId, tagId);
  }

  // ── Saved filters ───────────────────────────────────────────────────────

  @Get("workspaces/:id/filters")
  listFilters(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("projectId") projectId?: string,
  ) {
    return this.workspaces.listFilters(user.userId, id, projectId);
  }

  @Post("workspaces/:id/filters")
  createFilter(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CreateFilterDto) {
    return this.workspaces.createFilter(user.userId, id, dto);
  }

  @Patch("filters/:presetId")
  updateFilter(
    @CurrentUser() user: AuthUser,
    @Param("presetId") presetId: string,
    @Body() dto: UpdateFilterDto,
  ) {
    return this.workspaces.updateFilter(user.userId, presetId, dto);
  }

  @Delete("filters/:presetId")
  removeFilter(@CurrentUser() user: AuthUser, @Param("presetId") presetId: string) {
    return this.workspaces.removeFilter(user.userId, presetId);
  }
}
