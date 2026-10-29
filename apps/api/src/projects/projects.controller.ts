import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  CreateCustomFieldDto,
  CreateProjectDto,
  CreateStatusDto,
  CreateTemplateDto,
  ImportCsvDto,
  SetProjectMembersDto,
  UpdateCustomFieldDto,
  UpdateProjectDto,
  UpdateStatusDto,
} from "./projects.dto";
import { ProjectsService } from "./projects.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post("workspaces/:workspaceId/projects")
  create(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user.userId, workspaceId, dto);
  }

  @Get("projects/:id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.projects.detail(user.userId, id);
  }

  @Patch("projects/:id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user.userId, id, dto);
  }

  @Delete("projects/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.projects.remove(user.userId, id);
  }

  // ── Privacy, templates and CSV ──────────────────────────────────────────

  @Put("projects/:id/members")
  setMembers(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: SetProjectMembersDto,
  ) {
    return this.projects.setMembers(user.userId, id, dto);
  }

  @Get("workspaces/:workspaceId/templates")
  listTemplates(@CurrentUser() user: AuthUser, @Param("workspaceId") workspaceId: string) {
    return this.projects.listTemplates(user.userId, workspaceId);
  }

  @Post("projects/:id/templates")
  saveTemplate(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.projects.saveTemplate(user.userId, id, dto);
  }

  @Delete("templates/:templateId")
  removeTemplate(@CurrentUser() user: AuthUser, @Param("templateId") templateId: string) {
    return this.projects.removeTemplate(user.userId, templateId);
  }

  @Get("projects/:id/export")
  exportCsv(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.projects.exportCsv(user.userId, id);
  }

  @Post("projects/:id/import")
  importCsv(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: ImportCsvDto) {
    return this.projects.importCsv(user.userId, id, dto);
  }

  @Post("projects/:id/statuses")
  addStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: CreateStatusDto) {
    return this.projects.addStatus(user.userId, id, dto);
  }

  @Patch("statuses/:statusId")
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("statusId") statusId: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.projects.updateStatus(user.userId, statusId, dto);
  }

  @Delete("statuses/:statusId")
  removeStatus(@CurrentUser() user: AuthUser, @Param("statusId") statusId: string) {
    return this.projects.removeStatus(user.userId, statusId);
  }

  // ── Custom fields ───────────────────────────────────────────────────────

  @Get("projects/:id/fields")
  listFields(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.projects.listFields(user.userId, id);
  }

  @Post("projects/:id/fields")
  addField(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateCustomFieldDto,
  ) {
    return this.projects.addField(user.userId, id, dto);
  }

  @Patch("fields/:fieldId")
  updateField(
    @CurrentUser() user: AuthUser,
    @Param("fieldId") fieldId: string,
    @Body() dto: UpdateCustomFieldDto,
  ) {
    return this.projects.updateField(user.userId, fieldId, dto);
  }

  @Delete("fields/:fieldId")
  removeField(@CurrentUser() user: AuthUser, @Param("fieldId") fieldId: string) {
    return this.projects.removeField(user.userId, fieldId);
  }
}
