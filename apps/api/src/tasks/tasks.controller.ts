import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Priority } from "@prisma/client";
import type { Response } from "express";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  AddDependencyDto,
  AddObserverDto,
  CreateChecklistDto,
  CreateChecklistItemDto,
  CreateCommentDto,
  CreateReminderDto,
  CreateTaskDto,
  LogTimeDto,
  MoveTaskDto,
  SetCustomValueDto,
  SetRecurrenceDto,
  SetTaskTagsDto,
  UpdateChecklistDto,
  UpdateChecklistItemDto,
  UpdateTaskDto,
} from "./tasks.dto";
import { TasksService } from "./tasks.service";

const MAX_UPLOAD = 5 * 1024 * 1024;

@Controller()
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get("projects/:projectId/tasks")
  list(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Query("statusId") statusId?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("priority") priority?: Priority,
    @Query("tag") tag?: string,
    @Query("q") q?: string,
  ) {
    return this.tasks.list(user.userId, projectId, { statusId, assigneeId, priority, tag, q });
  }

  @Post("projects/:projectId/tasks")
  create(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(user.userId, projectId, dto);
  }

  @Get("workspaces/:workspaceId/tasks")
  mine(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string,
    @Query("scope") scope = "assigned",
  ) {
    return this.tasks.mine(user.userId, workspaceId, scope);
  }

  @Get("tasks/:id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tasks.detail(user.userId, id);
  }

  @Get("tasks/:id/history")
  history(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tasks.history(user.userId, id);
  }

  @Patch("tasks/:id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(user.userId, id, dto);
  }

  @Patch("tasks/:id/move")
  move(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: MoveTaskDto) {
    return this.tasks.move(user.userId, id, dto);
  }

  @Delete("tasks/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tasks.remove(user.userId, id);
  }

  // ── Discussion & time ───────────────────────────────────────────────────

  @Post("tasks/:id/comments")
  comment(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tasks.addComment(user.userId, id, dto);
  }

  @Delete("comments/:commentId")
  removeComment(@CurrentUser() user: AuthUser, @Param("commentId") commentId: string) {
    return this.tasks.removeComment(user.userId, commentId);
  }

  @Post("tasks/:id/time")
  logTime(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: LogTimeDto) {
    return this.tasks.logTime(user.userId, id, dto);
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  @Put("tasks/:id/tags")
  setTags(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SetTaskTagsDto) {
    return this.tasks.setTags(user.userId, id, dto);
  }

  // ── Checklists ──────────────────────────────────────────────────────────

  @Post("tasks/:id/checklists")
  addChecklist(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateChecklistDto,
  ) {
    return this.tasks.addChecklist(user.userId, id, dto);
  }

  @Patch("checklists/:checklistId")
  renameChecklist(
    @CurrentUser() user: AuthUser,
    @Param("checklistId") checklistId: string,
    @Body() dto: UpdateChecklistDto,
  ) {
    return this.tasks.renameChecklist(user.userId, checklistId, dto);
  }

  @Delete("checklists/:checklistId")
  removeChecklist(@CurrentUser() user: AuthUser, @Param("checklistId") checklistId: string) {
    return this.tasks.removeChecklist(user.userId, checklistId);
  }

  @Post("checklists/:checklistId/items")
  addChecklistItem(
    @CurrentUser() user: AuthUser,
    @Param("checklistId") checklistId: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.tasks.addChecklistItem(user.userId, checklistId, dto);
  }

  @Patch("checklist-items/:itemId")
  updateChecklistItem(
    @CurrentUser() user: AuthUser,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.tasks.updateChecklistItem(user.userId, itemId, dto);
  }

  @Delete("checklist-items/:itemId")
  removeChecklistItem(@CurrentUser() user: AuthUser, @Param("itemId") itemId: string) {
    return this.tasks.removeChecklistItem(user.userId, itemId);
  }

  // ── Observers ───────────────────────────────────────────────────────────

  @Post("tasks/:id/observers")
  addObserver(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AddObserverDto) {
    return this.tasks.addObserver(user.userId, id, dto);
  }

  @Delete("tasks/:id/observers/:userId")
  removeObserver(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("userId") observerId: string,
  ) {
    return this.tasks.removeObserver(user.userId, id, observerId);
  }

  // ── Reminders ───────────────────────────────────────────────────────────

  @Post("tasks/:id/reminders")
  addReminder(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateReminderDto,
  ) {
    return this.tasks.addReminder(user.userId, id, dto);
  }

  @Delete("reminders/:reminderId")
  removeReminder(@CurrentUser() user: AuthUser, @Param("reminderId") reminderId: string) {
    return this.tasks.removeReminder(user.userId, reminderId);
  }

  @Patch("reminders/:reminderId/dismiss")
  dismissReminder(@CurrentUser() user: AuthUser, @Param("reminderId") reminderId: string) {
    return this.tasks.dismissReminder(user.userId, reminderId);
  }

  // ── Dependencies ────────────────────────────────────────────────────────

  @Post("tasks/:id/dependencies")
  addDependency(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: AddDependencyDto,
  ) {
    return this.tasks.addDependency(user.userId, id, dto);
  }

  @Delete("tasks/:id/dependencies/:dependencyId")
  removeDependency(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("dependencyId") dependencyId: string,
  ) {
    return this.tasks.removeDependency(user.userId, id, dependencyId);
  }

  // ── Recurrence ──────────────────────────────────────────────────────────

  @Put("tasks/:id/recurrence")
  setRecurrence(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: SetRecurrenceDto,
  ) {
    return this.tasks.setRecurrence(user.userId, id, dto);
  }

  @Delete("tasks/:id/recurrence")
  clearRecurrence(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tasks.clearRecurrence(user.userId, id);
  }

  // ── Custom field values ─────────────────────────────────────────────────

  @Patch("tasks/:id/custom")
  setCustomValue(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: SetCustomValueDto,
  ) {
    return this.tasks.setCustomValue(user.userId, id, dto);
  }

  // ── Attachments ─────────────────────────────────────────────────────────

  @Post("tasks/:id/attachments")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD } }))
  uploadAttachment(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.tasks.addAttachment(user.userId, id, file);
  }

  @Get("attachments/:attachmentId")
  async downloadAttachment(
    @CurrentUser() user: AuthUser,
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ) {
    const file = await this.tasks.getAttachment(user.userId, attachmentId);

    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Length", file.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.end(file.data);
  }

  @Delete("attachments/:attachmentId")
  removeAttachment(@CurrentUser() user: AuthUser, @Param("attachmentId") attachmentId: string) {
    return this.tasks.removeAttachment(user.userId, attachmentId);
  }
}
