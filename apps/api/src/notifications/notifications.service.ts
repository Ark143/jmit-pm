import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AccessService } from "../common/access.service";
import { PrismaService } from "../prisma/prisma.service";

export interface NotifyInput {
  workspaceId: string;
  actorId: string | null;
  userIds: Array<string | null | undefined>;
  taskId?: string;
  type: string;
  title: string;
  body?: string;
}

const ACTOR = { id: true, name: true, color: true } as const;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** One row per recipient, actor excluded (nobody needs to be told they did it). */
  async notify(input: NotifyInput) {
    const recipients = [...new Set(input.userIds.filter(Boolean) as string[])].filter(
      (id) => id !== input.actorId,
    );
    if (recipients.length === 0) return;

    await this.prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        taskId: input.taskId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
      })),
    });
  }

  async list(userId: string, workspaceId: string) {
    await this.access.requireWorkspace(userId, workspaceId);
    await this.deliverDueReminders(userId, workspaceId);

    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, workspaceId },
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          actor: { select: ACTOR },
          task: {
            select: {
              id: true,
              number: true,
              title: true,
              project: { select: { id: true, key: true, color: true } },
            },
          },
        },
      }),
      this.prisma.notification.count({ where: { userId, workspaceId, readAt: null } }),
    ]);

    return { items, unread };
  }

  async markRead(userId: string, notificationId: string) {
    const found = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!found) throw new NotFoundException("Notification not found");
    if (found.userId !== userId) throw new ForbiddenException("That notification is not yours");

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: found.readAt ?? new Date() },
    });

    return { ok: true };
  }

  async markAllRead(userId: string, workspaceId?: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(workspaceId ? { workspaceId } : {}) },
      data: { readAt: new Date() },
    });

    return { ok: true };
  }

  /**
   * Reminders become inbox items the first time the owner looks, so a reminder
   * set for 3pm is waiting at 4pm even if nobody was online at 3pm.
   */
  private async deliverDueReminders(userId: string, workspaceId: string) {
    const due = await this.prisma.reminder.findMany({
      where: {
        userId,
        notifiedAt: null,
        dismissed: false,
        remindAt: { lte: new Date() },
        task: { project: { workspaceId, archived: false } },
      },
      take: 20,
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            project: { select: { key: true } },
          },
        },
      },
    });

    for (const reminder of due) {
      await this.prisma.notification.create({
        data: {
          userId,
          workspaceId,
          taskId: reminder.taskId,
          type: "reminder",
          title: `Reminder: ${reminder.task.project.key}-${reminder.task.number}`,
          body: reminder.task.title,
        },
      });
      await this.prisma.reminder.update({
        where: { id: reminder.id },
        data: { notifiedAt: new Date() },
      });
    }
  }
}
