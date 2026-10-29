import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Priority, RecurrenceRule, Role, StatusCategory } from "@prisma/client";
import { AccessService } from "../common/access.service";
import { PrismaService } from "../prisma/prisma.service";
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

const USER_FIELDS = { id: true, name: true, email: true, color: true } as const;

const LIST_INCLUDE = {
  assignee: { select: USER_FIELDS },
  tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
  _count: { select: { comments: true, subtasks: true, timeLogs: true, attachments: true } },
} as const;

export interface TaskFilters {
  statusId?: string;
  assigneeId?: string;
  priority?: Priority;
  tag?: string;
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

    const rows = await this.prisma.task.findMany({
      where: {
        projectId,
        parentId: filters.parentId ?? null,
        statusId: filters.statusId,
        assigneeId: filters.assigneeId,
        priority: filters.priority,
        title: filters.q ? { contains: filters.q, mode: "insensitive" } : undefined,
        tags: filters.tag ? { some: { tag: { name: { equals: filters.tag, mode: "insensitive" } } } } : undefined,
      },
      orderBy: [{ position: "asc" }, { number: "asc" }],
      include: LIST_INCLUDE,
    });

    return rows.map((row) => ({ ...row, tags: row.tags.map((t) => t.tag) }));
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
          plannedMinutes: dto.plannedMinutes ?? null,
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
        project: {
          select: {
            id: true,
            name: true,
            key: true,
            color: true,
            workspaceId: true,
            customFields: { orderBy: { position: "asc" } },
          },
        },
        subtasks: { orderBy: { number: "asc" }, include: LIST_INCLUDE },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: USER_FIELDS } },
        },
        timeLogs: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: USER_FIELDS } },
        },
        tags: { include: { tag: true } },
        checklists: {
          orderBy: { position: "asc" },
          include: {
            items: {
              orderBy: { position: "asc" },
              include: { assignee: { select: USER_FIELDS } },
            },
          },
        },
        observers: { include: { user: { select: USER_FIELDS } } },
        reminders: { orderBy: { remindAt: "asc" } },
        attachments: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, mime: true, size: true, createdAt: true } },
        customValues: true,
        blockedBy: {
          include: {
            dependsOn: {
              select: { id: true, number: true, title: true, status: { select: { id: true, name: true, category: true } } },
            },
          },
        },
        blocks: {
          include: {
            task: {
              select: { id: true, number: true, title: true, status: { select: { id: true, name: true, category: true } } },
            },
          },
        },
        recurrence: true,
      },
    });

    const loggedMinutes = task.timeLogs.reduce((sum, log) => sum + log.minutes, 0);

    return {
      ...task,
      tags: task.tags.map((t) => t.tag),
      observers: task.observers.map((o) => o.user),
      blockedBy: task.blockedBy.map((d) => ({ id: d.id, task: d.dependsOn })),
      blocks: task.blocks.map((d) => ({ id: d.id, task: d.task })),
      customFields: task.project.customFields,
      loggedMinutes,
    };
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

    if (statusCategory === StatusCategory.DONE) {
      await this.assertNotBlocked(taskId);
    }

    const wasDone = task.completedAt !== null;

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
        plannedMinutes: dto.plannedMinutes === undefined ? undefined : dto.plannedMinutes,
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

    if (!wasDone && updated.completedAt) {
      await this.spawnNextOccurrence(userId, taskId);
    }

    return updated;
  }

  async move(userId: string, taskId: string, dto: MoveTaskDto) {
    const { task, workspaceId, project } = await this.access.requireTask(userId, taskId);

    const status = await this.prisma.status.findFirst({
      where: { id: dto.statusId, projectId: task.projectId },
    });
    if (!status) throw new BadRequestException("That column does not belong to this project");

    if (status.category === StatusCategory.DONE) {
      await this.assertNotBlocked(taskId);
    }

    const wasDone = task.completedAt !== null;

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

    if (!wasDone && updated.completedAt) {
      await this.spawnNextOccurrence(userId, taskId);
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
            : scope === "deadlines"
              ? { ...base, dueDate: { not: null }, status: { category: { not: StatusCategory.DONE } } }
              : { ...base, assigneeId: userId, status: { category: { not: StatusCategory.DONE } } };

    const rows = await this.prisma.task.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
      take: 200,
      include: {
        ...LIST_INCLUDE,
        status: { select: { id: true, name: true, category: true } },
        project: { select: { id: true, name: true, key: true, color: true } },
      },
    });

    return rows.map((row) => ({ ...row, tags: row.tags.map((t) => t.tag) }));
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  async setTags(userId: string, taskId: string, dto: SetTaskTagsDto) {
    const { task, workspaceId, project } = await this.access.requireTask(userId, taskId);

    const names = [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))];

    const tagIds: string[] = [];
    for (const name of names) {
      const existing = await this.prisma.tag.findFirst({
        where: { workspaceId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });

      if (existing) {
        tagIds.push(existing.id);
        continue;
      }

      const created = await this.prisma.tag.create({
        data: { workspaceId, name, color: colorFor(name) },
        select: { id: true },
      });
      tagIds.push(created.id);
    }

    await this.prisma.$transaction([
      this.prisma.taskTag.deleteMany({ where: { taskId } }),
      this.prisma.taskTag.createMany({ data: tagIds.map((tagId) => ({ taskId, tagId })) }),
    ]);

    await this.access.log(
      workspaceId,
      userId,
      "task.tags",
      `tagged ${project.key}-${task.number}${names.length ? ` as ${names.join(", ")}` : ""}`,
      taskId,
    );

    return this.detail(userId, taskId);
  }

  // ── Checklists ──────────────────────────────────────────────────────────

  async addChecklist(userId: string, taskId: string, dto: CreateChecklistDto) {
    const { workspaceId, project, task } = await this.access.requireTask(userId, taskId);

    const last = await this.prisma.checklist.findFirst({
      where: { taskId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const checklist = await this.prisma.checklist.create({
      data: { taskId, title: dto.title.trim(), position: (last?.position ?? -1) + 1 },
    });

    await this.access.log(
      workspaceId,
      userId,
      "checklist.create",
      `added a checklist to ${project.key}-${task.number}`,
      taskId,
    );

    return checklist;
  }

  async renameChecklist(userId: string, checklistId: string, dto: UpdateChecklistDto) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId } });
    if (!checklist) throw new NotFoundException("Checklist not found");
    await this.access.requireTask(userId, checklist.taskId);

    return this.prisma.checklist.update({
      where: { id: checklistId },
      data: { title: dto.title.trim() },
    });
  }

  async removeChecklist(userId: string, checklistId: string) {
    const checklist = await this.prisma.checklist.findUnique({ where: { id: checklistId } });
    if (!checklist) throw new NotFoundException("Checklist not found");
    await this.access.requireTask(userId, checklist.taskId);

    await this.prisma.checklist.delete({ where: { id: checklistId } });
    return { ok: true };
  }

  async addChecklistItem(userId: string, checklistId: string, dto: CreateChecklistItemDto) {
    const checklist = await this.prisma.checklist.findUnique({
      where: { id: checklistId },
      include: { task: { include: { project: true } } },
    });
    if (!checklist) throw new NotFoundException("Checklist not found");

    const { workspaceId } = await this.access.requireTask(userId, checklist.taskId);
    await this.assertAssignee(workspaceId, dto.assigneeId);

    const last = await this.prisma.checklistItem.findFirst({
      where: { checklistId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    return this.prisma.checklistItem.create({
      data: {
        checklistId,
        text: dto.text.trim(),
        assigneeId: dto.assigneeId ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        position: (last?.position ?? -1) + 1,
      },
      include: { assignee: { select: USER_FIELDS } },
    });
  }

  async updateChecklistItem(userId: string, itemId: string, dto: UpdateChecklistItemDto) {
    const item = await this.prisma.checklistItem.findUnique({
      where: { id: itemId },
      include: { checklist: true },
    });
    if (!item) throw new NotFoundException("Checklist item not found");

    const { workspaceId } = await this.access.requireTask(userId, item.checklist.taskId);
    await this.assertAssignee(workspaceId, dto.assigneeId);

    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        text: dto.text?.trim(),
        done: dto.done,
        assigneeId: dto.assigneeId === undefined ? undefined : dto.assigneeId,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: { assignee: { select: USER_FIELDS } },
    });
  }

  async removeChecklistItem(userId: string, itemId: string) {
    const item = await this.prisma.checklistItem.findUnique({
      where: { id: itemId },
      include: { checklist: true },
    });
    if (!item) throw new NotFoundException("Checklist item not found");
    await this.access.requireTask(userId, item.checklist.taskId);

    await this.prisma.checklistItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  // ── Observers ───────────────────────────────────────────────────────────

  async addObserver(userId: string, taskId: string, dto: AddObserverDto) {
    const { workspaceId, project, task } = await this.access.requireTask(userId, taskId);
    await this.assertAssignee(workspaceId, dto.userId);

    const existing = await this.prisma.taskObserver.findUnique({
      where: { taskId_userId: { taskId, userId: dto.userId } },
    });
    if (existing) return this.detail(userId, taskId);

    await this.prisma.taskObserver.create({ data: { taskId, userId: dto.userId } });
    await this.access.log(
      workspaceId,
      userId,
      "task.observer",
      `added an observer to ${project.key}-${task.number}`,
      taskId,
    );

    return this.detail(userId, taskId);
  }

  async removeObserver(userId: string, taskId: string, observerId: string) {
    await this.access.requireTask(userId, taskId);
    await this.prisma.taskObserver.deleteMany({ where: { taskId, userId: observerId } });
    return this.detail(userId, taskId);
  }

  // ── Reminders ───────────────────────────────────────────────────────────

  async addReminder(userId: string, taskId: string, dto: CreateReminderDto) {
    await this.access.requireTask(userId, taskId);

    return this.prisma.reminder.create({
      data: { taskId, userId, remindAt: new Date(dto.remindAt) },
    });
  }

  async removeReminder(userId: string, reminderId: string) {
    const reminder = await this.prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) throw new NotFoundException("Reminder not found");
    if (reminder.userId !== userId) throw new ForbiddenException("That reminder is not yours");

    await this.prisma.reminder.delete({ where: { id: reminderId } });
    return { ok: true };
  }

  async dismissReminder(userId: string, reminderId: string) {
    const reminder = await this.prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) throw new NotFoundException("Reminder not found");
    if (reminder.userId !== userId) throw new ForbiddenException("That reminder is not yours");

    await this.prisma.reminder.update({ where: { id: reminderId }, data: { dismissed: true } });
    return { ok: true };
  }

  // ── Dependencies ────────────────────────────────────────────────────────

  async addDependency(userId: string, taskId: string, dto: AddDependencyDto) {
    const { project, workspaceId, task } = await this.access.requireTask(userId, taskId);

    if (dto.dependsOnId === taskId) {
      throw new BadRequestException("A task cannot depend on itself");
    }

    const other = await this.prisma.task.findFirst({
      where: { id: dto.dependsOnId, projectId: task.projectId },
    });
    if (!other) throw new BadRequestException("That task is not in this project");

    if (await this.createsCycle(taskId, dto.dependsOnId)) {
      throw new BadRequestException("That would create a circular dependency");
    }

    const existing = await this.prisma.taskDependency.findUnique({
      where: { taskId_dependsOnId: { taskId, dependsOnId: dto.dependsOnId } },
    });
    if (existing) return this.detail(userId, taskId);

    await this.prisma.taskDependency.create({ data: { taskId, dependsOnId: dto.dependsOnId } });
    await this.access.log(
      workspaceId,
      userId,
      "task.dependency",
      `linked ${project.key}-${task.number} to ${project.key}-${other.number}`,
      taskId,
    );

    return this.detail(userId, taskId);
  }

  async removeDependency(userId: string, taskId: string, dependencyId: string) {
    await this.access.requireTask(userId, taskId);
    await this.prisma.taskDependency.deleteMany({ where: { id: dependencyId, taskId } });
    return this.detail(userId, taskId);
  }

  // ── Recurrence ──────────────────────────────────────────────────────────

  async setRecurrence(userId: string, taskId: string, dto: SetRecurrenceDto) {
    await this.access.requireTask(userId, taskId);

    const nextAt = this.nextDate(new Date(), dto.rule, dto.interval ?? 1);

    return this.prisma.recurrence.upsert({
      where: { taskId },
      create: { taskId, rule: dto.rule, interval: dto.interval ?? 1, nextAt },
      update: { rule: dto.rule, interval: dto.interval ?? 1, nextAt },
    });
  }

  async clearRecurrence(userId: string, taskId: string) {
    await this.access.requireTask(userId, taskId);
    await this.prisma.recurrence.deleteMany({ where: { taskId } });
    return { ok: true };
  }

  // ── Custom field values ─────────────────────────────────────────────────

  async setCustomValue(userId: string, taskId: string, dto: SetCustomValueDto) {
    const { task } = await this.access.requireTask(userId, taskId);

    const field = await this.prisma.customField.findFirst({
      where: { id: dto.fieldId, projectId: task.projectId },
    });
    if (!field) throw new BadRequestException("That field does not belong to this project");

    const value = dto.value ?? null;

    if (value === null || value === "") {
      await this.prisma.customFieldValue.deleteMany({ where: { fieldId: field.id, taskId } });
      return { fieldId: field.id, value: null };
    }

    return this.prisma.customFieldValue.upsert({
      where: { fieldId_taskId: { fieldId: field.id, taskId } },
      create: { fieldId: field.id, taskId, value },
      update: { value },
    });
  }

  // ── Attachments ─────────────────────────────────────────────────────────

  async addAttachment(userId: string, taskId: string, file?: Express.Multer.File) {
    const { workspaceId, project, task } = await this.access.requireTask(userId, taskId);

    if (!file) throw new BadRequestException("Choose a file to upload");
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException("Files must be 5 MB or smaller");

    const attachment = await this.prisma.attachment.create({
      data: {
        taskId,
        name: sanitizeName(file.originalname),
        mime: file.mimetype || "application/octet-stream",
        size: file.size,
        data: Uint8Array.from(file.buffer),
      },
      select: { id: true, name: true, mime: true, size: true, createdAt: true },
    });

    await this.access.log(
      workspaceId,
      userId,
      "task.file",
      `attached ${attachment.name} to ${project.key}-${task.number}`,
      taskId,
    );

    return attachment;
  }

  async getAttachment(userId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException("File not found");

    await this.access.requireTask(userId, attachment.taskId);

    return {
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      data: Buffer.from(attachment.data),
    };
  }

  async removeAttachment(userId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException("File not found");

    await this.access.requireTask(userId, attachment.taskId);
    await this.prisma.attachment.delete({ where: { id: attachmentId } });

    return { ok: true };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async assertAssignee(workspaceId: string, assigneeId?: string | null) {
    if (!assigneeId) return;

    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: assigneeId, workspaceId } },
    });
    if (!member) throw new BadRequestException("That person is not in this workspace");
  }

  private async assertNotBlocked(taskId: string) {
    const blockers = await this.prisma.taskDependency.findMany({
      where: { taskId, dependsOn: { completedAt: null } },
      include: {
        dependsOn: { select: { number: true, title: true, project: { select: { key: true } } } },
      },
    });

    if (blockers.length > 0) {
      const names = blockers
        .map((row) => `${row.dependsOn.project.key}-${row.dependsOn.number}`)
        .join(", ");
      throw new BadRequestException(`Finish the blocking tasks first: ${names}`);
    }
  }

  private async createsCycle(taskId: string, dependsOnId: string) {
    const seen = new Set<string>();
    const queue = [dependsOnId];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (current === taskId) return true;
      if (seen.has(current)) continue;
      seen.add(current);

      const rows = await this.prisma.taskDependency.findMany({
        where: { taskId: current },
        select: { dependsOnId: true },
      });
      for (const row of rows) queue.push(row.dependsOnId);
    }

    return false;
  }

  private nextDate(from: Date, rule: RecurrenceRule, interval: number) {
    const next = new Date(from);
    if (rule === RecurrenceRule.DAILY) next.setDate(next.getDate() + interval);
    else if (rule === RecurrenceRule.WEEKLY) next.setDate(next.getDate() + interval * 7);
    else next.setMonth(next.getMonth() + interval);
    return next;
  }

  /** Copies a completed recurring task forward and resets its checklist. */
  private async spawnNextOccurrence(userId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        recurrence: true,
        checklists: { include: { items: true } },
        tags: true,
        customValues: true,
        observers: true,
        project: { select: { id: true, key: true, workspaceId: true } },
      },
    });

    if (!task?.recurrence) return;

    const firstStatus = await this.prisma.status.findFirst({
      where: { projectId: task.projectId },
      orderBy: { position: "asc" },
    });
    if (!firstStatus) return;

    const last = await this.prisma.task.findFirst({
      where: { projectId: task.projectId },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    const base = task.dueDate ?? new Date();
    const nextDue = this.nextDate(base, task.recurrence.rule, task.recurrence.interval);

    const created = await this.prisma.task.create({
      data: {
        projectId: task.projectId,
        number: (last?.number ?? 0) + 1,
        title: task.title,
        description: task.description,
        statusId: firstStatus.id,
        priority: task.priority,
        assigneeId: task.assigneeId,
        creatorId: userId,
        position: 0,
        startDate: task.startDate ? this.nextDate(task.startDate, task.recurrence.rule, task.recurrence.interval) : null,
        dueDate: nextDue,
        plannedMinutes: task.plannedMinutes,
        tags: { create: task.tags.map((t) => ({ tagId: t.tagId })) },
        observers: { create: task.observers.map((o) => ({ userId: o.userId })) },
        customValues: {
          create: task.customValues
            .filter((v) => v.value !== null)
            .map((v) => ({ fieldId: v.fieldId, value: v.value })),
        },
        checklists: {
          create: task.checklists.map((list, index) => ({
            title: list.title,
            position: index,
            items: {
              create: list.items.map((item, itemIndex) => ({
                text: item.text,
                assigneeId: item.assigneeId,
                dueDate: item.dueDate,
                position: itemIndex,
              })),
            },
          })),
        },
        recurrence: {
          create: {
            rule: task.recurrence.rule,
            interval: task.recurrence.interval,
            nextAt: nextDue,
          },
        },
      },
    });

    await this.prisma.recurrence.update({
      where: { taskId },
      data: { nextAt: nextDue },
    });

    await this.access.log(
      task.project.workspaceId,
      userId,
      "task.recurring",
      `recurring task created ${task.project.key}-${created.number}`,
      created.id,
    );
  }
}

const PALETTE = ["#4f8cff", "#f5734a", "#22b07d", "#a855f7", "#0ea5e9", "#d4a017", "#ec4899", "#8b93a1"];

function sanitizeName(name: string) {
  const cleaned = name.replace(/[\\/\r\n\t]/g, "_").trim();
  return (cleaned || "file").slice(0, 200);
}

function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
