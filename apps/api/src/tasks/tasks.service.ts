import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Priority, Role, StatusCategory } from "@prisma/client";
import { AccessService } from "../common/access.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateCommentDto,
  CreateTaskDto,
  LogTimeDto,
  MoveTaskDto,
  UpdateTaskDto,
} from "./tasks.dto";

const USER_FIELDS = { id: true, name: true, email: true, color: true } as const;

const LIST_INCLUDE = {
  assignee: { select: USER_FIELDS },
  _count: { select: { comments: true, subtasks: true, timeLogs: true } },
} as const;

export interface TaskFilters {
  statusId?: string;
  assigneeId?: string;
  priority?: Priority;
  q?: string;
  parentId?: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(userId: string, projectId: string, filters: TaskFilters) {
    await this.access.requireProject(userId, projectId);

    return this.prisma.task.findMany({
      where: {
        projectId,
        parentId: filters.parentId ?? null,
        statusId: filters.statusId,
        assigneeId: filters.assigneeId,
        priority: filters.priority,
        title: filters.q ? { contains: filters.q, mode: "insensitive" } : undefined,
      },
      orderBy: [{ position: "asc" }, { number: "asc" }],
      include: LIST_INCLUDE,
    });
  }

  async create(userId: string, projectId: string, dto: CreateTaskDto) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);

    const status = dto.statusId
      ? await this.prisma.status.findFirst({ where: { id: dto.statusId, projectId } })
      : await this.prisma.status.findFirst({
          where: { projectId },
          orderBy: { position: "asc" },
        });

    if (!status) throw new BadRequestException("That column does not belong to this project");
    await this.assertAssignee(workspaceId, dto.assigneeId);

    if (dto.parentId) {
      const parent = await this.prisma.task.findFirst({
        where: { id: dto.parentId, projectId },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException("Parent task not found in this project");
    }

    const task = await this.prisma.$transaction(async (tx) => {
      const last = await tx.task.findFirst({
        where: { projectId },
        orderBy: { number: "desc" },
        select: { number: true },
      });

      const lastInColumn = await tx.task.findFirst({
        where: { projectId, statusId: status.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });

      return tx.task.create({
        data: {
          projectId,
          number: (last?.number ?? 0) + 1,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          statusId: status.id,
          priority: dto.priority ?? Priority.MEDIUM,
          assigneeId: dto.assigneeId ?? null,
          creatorId: userId,
          parentId: dto.parentId ?? null,
          position: (lastInColumn?.position ?? 0) + 1,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          estimateHours: dto.estimateHours ?? null,
          completedAt: status.category === StatusCategory.DONE ? new Date() : null,
        },
      });
    });

    await this.access.log(
      workspaceId,
      userId,
      "task.create",
      `created ${project.key}-${task.number}: ${task.title}`,
      task.id,
    );

    return this.detail(userId, task.id);
  }

  async detail(userId: string, taskId: string) {
    await this.access.requireTask(userId, taskId);

    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        assignee: { select: USER_FIELDS },
        creator: { select: USER_FIELDS },
        status: true,
        project: { select: { id: true, name: true, key: true, color: true, workspaceId: true } },
        subtasks: { orderBy: { number: "asc" }, include: LIST_INCLUDE },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: USER_FIELDS } },
        },
        timeLogs: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: USER_FIELDS } },
        },
      },
    });

    const loggedMinutes = task.timeLogs.reduce((sum, log) => sum + log.minutes, 0);

    return { ...task, loggedMinutes };
  }

  async update(userId: string, taskId: string, dto: UpdateTaskDto) {
    const { task, workspaceId, project } = await this.access.requireTask(userId, taskId);

    let statusCategory: StatusCategory | undefined;
    if (dto.statusId && dto.statusId !== task.statusId) {
      const status = await this.prisma.status.findFirst({
        where: { id: dto.statusId, projectId: task.projectId },
      });
      if (!status) throw new BadRequestException("That column does not belong to this project");
      statusCategory = status.category;
    }

    await this.assertAssignee(workspaceId, dto.assigneeId);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        statusId: dto.statusId,
        priority: dto.priority,
        assigneeId: dto.assigneeId === undefined ? undefined : dto.assigneeId,
        startDate: dto.startDate === undefined ? undefined : dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
        estimateHours: dto.estimateHours === undefined ? undefined : dto.estimateHours,
        completedAt:
          statusCategory === undefined
            ? undefined
            : statusCategory === StatusCategory.DONE
              ? new Date()
              : null,
      },
    });

    if (dto.statusId && statusCategory) {
      const status = await this.prisma.status.findUniqueOrThrow({ where: { id: dto.statusId } });
      await this.access.log(
        workspaceId,
        userId,
        "task.status",
        `moved ${project.key}-${task.number} to ${status.name}`,
        taskId,
      );
    } else if (dto.assigneeId !== undefined) {
      await this.access.log(
        workspaceId,
        userId,
        "task.assign",
        `reassigned ${project.key}-${task.number}`,
        taskId,
      );
    } else {
      await this.access.log(
        workspaceId,
        userId,
        "task.update",
        `updated ${project.key}-${task.number}`,
        taskId,
      );
    }

    return updated;
  }

  async move(userId: string, taskId: string, dto: MoveTaskDto) {
    const { task, workspaceId, project } = await this.access.requireTask(userId, taskId);

    const status = await this.prisma.status.findFirst({
      where: { id: dto.statusId, projectId: task.projectId },
    });
    if (!status) throw new BadRequestException("That column does not belong to this project");

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        statusId: status.id,
        position: dto.position,
        completedAt:
          status.category === StatusCategory.DONE ? (task.completedAt ?? new Date()) : null,
      },
    });

    if (status.id !== task.statusId) {
      await this.access.log(
        workspaceId,
        userId,
        "task.status",
        `moved ${project.key}-${task.number} to ${status.name}`,
        taskId,
      );
    }

    return updated;
  }

  async remove(userId: string, taskId: string) {
    const { task, workspaceId, project } = await this.access.requireTask(userId, taskId);

    await this.prisma.task.delete({ where: { id: taskId } });
    await this.access.log(
      workspaceId,
      userId,
      "task.delete",
      `deleted ${project.key}-${task.number}: ${task.title}`,
    );

    return { ok: true };
  }

  async addComment(userId: string, taskId: string, dto: CreateCommentDto) {
    const { workspaceId, project, task } = await this.access.requireTask(userId, taskId);

    const comment = await this.prisma.comment.create({
      data: { taskId, authorId: userId, body: dto.body.trim() },
      include: { author: { select: USER_FIELDS } },
    });

    await this.access.log(
      workspaceId,
      userId,
      "comment.create",
      `commented on ${project.key}-${task.number}`,
      taskId,
    );

    return comment;
  }

  async removeComment(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { task: { include: { project: true } } },
    });
    if (!comment) throw new NotFoundException("Comment not found");

    const { role } = await this.access.requireTask(userId, comment.taskId);
    if (comment.authorId !== userId && role === Role.MEMBER) {
      throw new ForbiddenException("You can only delete your own comments");
    }

    await this.prisma.comment.delete({ where: { id: commentId } });
    return { ok: true };
  }

  async logTime(userId: string, taskId: string, dto: LogTimeDto) {
    await this.access.requireTask(userId, taskId);

    return this.prisma.timeLog.create({
      data: { taskId, userId, minutes: dto.minutes, note: dto.note?.trim() || null },
      include: { user: { select: USER_FIELDS } },
    });
  }

  /** Cross-project "my tasks" view. */
  async mine(userId: string, workspaceId: string, scope: string) {
    await this.access.requireWorkspace(userId, workspaceId);

    const base = {
      project: { workspaceId, archived: false },
      parentId: null,
    } as const;

    const now = new Date();
    const where =
      scope === "created"
        ? { ...base, creatorId: userId }
        : scope === "overdue"
          ? { ...base, assigneeId: userId, dueDate: { lt: now }, status: { category: { not: StatusCategory.DONE } } }
          : scope === "done"
            ? { ...base, assigneeId: userId, status: { category: StatusCategory.DONE } }
            : { ...base, assigneeId: userId, status: { category: { not: StatusCategory.DONE } } };

    return this.prisma.task.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
      take: 100,
      include: {
        ...LIST_INCLUDE,
        status: { select: { id: true, name: true, category: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
      },
    });
  }

  private async assertAssignee(workspaceId: string, assigneeId?: string | null) {
    if (!assigneeId) return;

    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: assigneeId, workspaceId } },
    });
    if (!member) throw new BadRequestException("That person is not in this workspace");
  }
}
