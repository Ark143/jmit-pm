import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Priority } from "@prisma/client";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  CreateCommentDto,
  CreateTaskDto,
  LogTimeDto,
  MoveTaskDto,
  UpdateTaskDto,
} from "./tasks.dto";
import { TasksService } from "./tasks.service";

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
    @Query("q") q?: string,
  ) {
    return this.tasks.list(user.userId, projectId, { statusId, assigneeId, priority, q });
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
}
