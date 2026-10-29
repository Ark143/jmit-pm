import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Priority, Role, StatusCategory } from "@prisma/client";
import { randomBytes } from "crypto";
import { AccessService } from "../common/access.service";
import { EventsService } from "../events/events.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AddMemberDto,
  CreateFilterDto,
  CreateInviteDto,
  CreateTagDto,
  CreateWorkspaceDto,
  UpdateFilterDto,
} from "./workspaces.dto";

const DEFAULT_STATUSES: Array<{ name: string; category: StatusCategory }> = [
  { name: "To do", category: StatusCategory.TODO },
  { name: "In progress", category: StatusCategory.IN_PROGRESS },
  { name: "Done", category: StatusCategory.DONE },
];

const USER_FIELDS = { id: true, name: true, email: true, color: true } as const;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: {
        workspace: {
          include: {
            _count: { select: { projects: true, memberships: true } },
          },
        },
      },
    });

    const roleByWorkspace = new Map(memberships.map((m) => [m.workspace.id, m.role]));

    // Members only see public projects plus private ones they were invited to.
    const privateMemberships = new Set(
      (
        await this.prisma.projectMember.findMany({
          where: { userId },
          select: { projectId: true },
        })
      ).map((row) => row.projectId),
    );

    const projects = await this.prisma.project.findMany({
      where: { workspace: { memberships: { some: { userId } } }, archived: false },
      select: { id: true, workspaceId: true, visibility: true },
    });

    const visible = projects.filter((project) => {
      const role = roleByWorkspace.get(project.workspaceId);
      if (role !== Role.MEMBER) return true;
      return project.visibility !== "PRIVATE" || privateMemberships.has(project.id);
    });

    const projectCountByWorkspace = new Map<string, number>();
    for (const project of visible) {
      projectCountByWorkspace.set(
        project.workspaceId,
        (projectCountByWorkspace.get(project.workspaceId) ?? 0) + 1,
      );
    }

    const openTasks = await this.prisma.task.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: visible.map((project) => project.id) },
        status: { category: { not: StatusCategory.DONE } },
      },
      _count: { _all: true },
    });

    const workspaceOfProject = new Map(visible.map((p) => [p.id, p.workspaceId]));
    const openByWorkspace = new Map<string, number>();
    for (const row of openTasks) {
      const wsId = workspaceOfProject.get(row.projectId);
      if (!wsId) continue;
      openByWorkspace.set(wsId, (openByWorkspace.get(wsId) ?? 0) + row._count._all);
    }

    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
      projectCount: projectCountByWorkspace.get(m.workspace.id) ?? 0,
      memberCount: m.workspace._count.memberships,
      openTasks: openByWorkspace.get(m.workspace.id) ?? 0,
    }));
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name.trim(),
        memberships: { create: { userId, role: Role.OWNER } },
        projects: {
          create: {
            name: "General",
            key: "GEN",
            color: "#4f8cff",
            statuses: { create: DEFAULT_STATUSES.map((s, i) => ({ ...s, position: i })) },
          },
        },
      },
    });

    return { id: workspace.id, name: workspace.name, role: Role.OWNER };
  }

  async get(userId: string, workspaceId: string) {
    const { role } = await this.access.requireWorkspace(userId, workspaceId);
    const visibility = this.access.projectVisibilityFilter(userId, role);

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: {
        memberships: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: USER_FIELDS } },
        },
        projects: {
          where: { archived: false, ...visibility },
          orderBy: { createdAt: "asc" },
          include: {
            statuses: { orderBy: { position: "asc" } },
            members: { select: { userId: true } },
            _count: { select: { tasks: true } },
          },
        },
      },
    });

    const doneCounts = await this.prisma.task.groupBy({
      by: ["projectId"],
      where: { project: { workspaceId }, status: { category: StatusCategory.DONE } },
      _count: { _all: true },
    });
    const doneByProject = new Map(doneCounts.map((r) => [r.projectId, r._count._all]));

    return {
      id: workspace.id,
      name: workspace.name,
      role,
      members: workspace.memberships.map((m) => ({
        role: m.role,
        joinedAt: m.createdAt,
        user: m.user,
      })),
      projects: workspace.projects.map((p) => ({
        id: p.id,
        name: p.name,
        key: p.key,
        color: p.color,
        description: p.description,
        visibility: p.visibility,
        memberIds: p.members.map((member) => member.userId),
        statuses: p.statuses,
        taskCount: p._count.tasks,
        doneCount: doneByProject.get(p.id) ?? 0,
      })),
    };
  }

  async addMember(userId: string, workspaceId: string, dto: AddMemberDto) {
    await this.access.requireAdmin(userId, workspaceId);

    const target = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      select: USER_FIELDS,
    });
    if (!target) {
      throw new NotFoundException(
        "No account uses that email yet — send an invite instead and they can join from the link",
      );
    }

    const existing = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: target.id, workspaceId } },
    });
    if (existing) throw new BadRequestException("That person is already a member");

    const membership = await this.prisma.membership.create({
      data: { userId: target.id, workspaceId, role: dto.role ?? Role.MEMBER },
      include: { user: { select: USER_FIELDS } },
    });

    await this.access.log(workspaceId, userId, "member.add", `added ${target.name} to the workspace`);
    this.events.emit(workspaceId, "member.changed");

    await this.notifications.notify({
      workspaceId,
      actorId: userId,
      userIds: [target.id],
      type: "member.add",
      title: "You were added to a workspace",
      body: "Open it from the workspace switcher to see the projects.",
    });

    return { role: membership.role, joinedAt: membership.createdAt, user: membership.user };
  }

  async removeMember(userId: string, workspaceId: string, targetUserId: string) {
    await this.access.requireAdmin(userId, workspaceId);

    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      include: { user: { select: USER_FIELDS } },
    });
    if (!membership) throw new NotFoundException("That person is not a member");

    if (membership.role === Role.OWNER) {
      const owners = await this.prisma.membership.count({
        where: { workspaceId, role: Role.OWNER },
      });
      if (owners <= 1) throw new BadRequestException("A workspace needs at least one owner");
    }

    await this.prisma.membership.delete({ where: { id: membership.id } });
    await this.access.log(workspaceId, userId, "member.remove", `removed ${membership.user.name}`);
    this.events.emit(workspaceId, "member.changed");

    return { ok: true };
  }

  // ── Invitations ─────────────────────────────────────────────────────────

  async listInvites(userId: string, workspaceId: string) {
    await this.access.requireAdmin(userId, workspaceId);

    return this.prisma.workspaceInvite.findMany({
      where: { workspaceId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: USER_FIELDS } },
    });
  }

  async createInvite(userId: string, workspaceId: string, dto: CreateInviteDto) {
    await this.access.requireAdmin(userId, workspaceId);

    const email = dto.email.trim().toLowerCase();
    const role = dto.role ?? Role.MEMBER;
    if (role === Role.OWNER) {
      throw new BadRequestException("Invite as admin or member, then promote them");
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true },
    });
    if (existingUser) {
      const member = await this.prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
      });
      if (member) {
        throw new BadRequestException(`${existingUser.name} is already in this workspace`);
      }
    }

    // One live link per address: re-inviting replaces the old one.
    await this.prisma.workspaceInvite.updateMany({
      where: { workspaceId, email, status: "PENDING" },
      data: { status: "REVOKED" },
    });

    const invite = await this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        email,
        role,
        token: randomBytes(24).toString("base64url"),
        invitedById: userId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      include: { invitedBy: { select: USER_FIELDS } },
    });

    await this.access.log(workspaceId, userId, "invite.create", `invited ${email}`);

    return invite;
  }

  async revokeInvite(userId: string, inviteId: string) {
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException("Invite not found");

    await this.access.requireAdmin(userId, invite.workspaceId);
    await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { status: "REVOKED" },
    });

    return { ok: true };
  }

  /** Public: someone opening the join link before signing in still sees what it is. */
  async previewInvite(token: string) {
    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { token },
      include: {
        workspace: { select: { id: true, name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!invite) throw new NotFoundException("That invite link is not valid");

    return {
      workspaceId: invite.workspace.id,
      workspaceName: invite.workspace.name,
      inviterName: invite.invitedBy.name,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(userId: string, token: string) {
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException("That invite link is not valid");

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new BadRequestException(
        `This invite is for ${invite.email}. Sign in with that address to join.`,
      );
    }

    if (invite.status === "REVOKED") {
      throw new BadRequestException("That invite was cancelled — ask for a new link");
    }
    if (invite.status === "PENDING" && invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("That invite expired — ask for a new link");
    }

    const existing = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
    });

    if (!existing) {
      await this.prisma.membership.create({
        data: { userId, workspaceId: invite.workspaceId, role: invite.role },
      });
    }

    if (invite.status !== "ACCEPTED") {
      await this.prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED", acceptedById: userId },
      });
      await this.access.log(invite.workspaceId, userId, "member.join", `${user.name} joined the workspace`);

      const admins = await this.prisma.membership.findMany({
        where: { workspaceId: invite.workspaceId, role: { in: [Role.OWNER, Role.ADMIN] } },
        select: { userId: true },
      });

      await this.notifications.notify({
        workspaceId: invite.workspaceId,
        actorId: userId,
        userIds: admins.map((row) => row.userId),
        type: "member.join",
        title: `${user.name} joined the workspace`,
        body: user.email,
      });
      this.events.emit(invite.workspaceId, "member.changed");
    }

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: invite.workspaceId },
      select: { id: true, name: true },
    });

    return { workspace: { id: workspace.id, name: workspace.name }, role: invite.role };
  }

  // ── Search ──────────────────────────────────────────────────────────────

  async search(userId: string, workspaceId: string, rawQuery: string) {
    const { role } = await this.access.requireWorkspace(userId, workspaceId);
    const visibility = this.access.projectVisibilityFilter(userId, role);

    const term = rawQuery.trim();
    if (term.length < 2) {
      return { tasks: [], projects: [], tags: [] };
    }

    const [tasks, projects, tags] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          project: { workspaceId, archived: false, ...visibility },
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { comments: { some: { body: { contains: term, mode: "insensitive" } } } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          number: true,
          title: true,
          priority: true,
          dueDate: true,
          assignee: { select: USER_FIELDS },
          status: { select: { id: true, name: true, category: true } },
          project: { select: { id: true, name: true, key: true, color: true } },
        },
      }),
      this.prisma.project.findMany({
        where: {
          workspaceId,
          archived: false,
          ...visibility,
          name: { contains: term, mode: "insensitive" },
        },
        take: 8,
        select: { id: true, name: true, key: true, color: true },
      }),
      this.prisma.tag.findMany({
        where: { workspaceId, name: { contains: term, mode: "insensitive" } },
        take: 8,
        include: { _count: { select: { tasks: true } } },
      }),
    ]);

    return { tasks, projects, tags };
  }

  async dashboard(userId: string, workspaceId: string) {
    const { role } = await this.access.requireWorkspace(userId, workspaceId);
    const visibility = this.access.projectVisibilityFilter(userId, role);
    const projectScope = { workspaceId, archived: false, ...visibility };

    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const openWhere = {
      project: projectScope,
      status: { category: { not: StatusCategory.DONE } },
    };

    const [open, overdue, dueThisWeek, completedThisWeek, byPriority, byStatus, upcoming, activity, members, reminders] =
      await Promise.all([
        this.prisma.task.count({ where: openWhere }),
        this.prisma.task.count({
          where: { ...openWhere, dueDate: { lt: now } },
        }),
        this.prisma.task.count({
          where: { ...openWhere, dueDate: { gte: now, lte: weekAhead } },
        }),
        this.prisma.task.count({
          where: {
            project: projectScope,
            status: { category: StatusCategory.DONE },
            completedAt: { gte: weekAgo },
          },
        }),
        this.prisma.task.groupBy({
          by: ["priority"],
          where: openWhere,
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ["statusId"],
          where: { project: projectScope },
          _count: { _all: true },
        }),
        this.prisma.task.findMany({
          where: { ...openWhere, dueDate: { not: null } },
          orderBy: { dueDate: "asc" },
          take: 8,
          include: {
            assignee: { select: USER_FIELDS },
            project: { select: { id: true, name: true, key: true, color: true } },
            status: { select: { id: true, name: true, category: true } },
          },
        }),
        this.prisma.activity.findMany({
          where: { workspaceId },
          orderBy: { createdAt: "desc" },
          take: 15,
          include: { actor: { select: USER_FIELDS } },
        }),
        this.prisma.membership.findMany({
          where: { workspaceId },
          include: { user: { select: USER_FIELDS } },
        }),
        this.prisma.reminder.findMany({
          where: { userId, dismissed: false, task: { project: projectScope } },
          orderBy: { remindAt: "asc" },
          take: 12,
          include: {
            task: {
              select: {
                id: true,
                number: true,
                title: true,
                dueDate: true,
                project: { select: { id: true, name: true, key: true, color: true } },
              },
            },
          },
        }),
      ]);

    const workloadRows = await this.prisma.task.groupBy({
      by: ["assigneeId", "priority"],
      where: { ...openWhere, assigneeId: { not: null } },
      _count: { _all: true },
    });

    const overdueRows = await this.prisma.task.groupBy({
      by: ["assigneeId"],
      where: { ...openWhere, dueDate: { lt: now }, assigneeId: { not: null } },
      _count: { _all: true },
    });
    const overdueByUser = new Map(overdueRows.map((r) => [r.assigneeId, r._count._all]));

    const workload = members.map((m) => {
      const rows = workloadRows.filter((r) => r.assigneeId === m.userId);
      const total = rows.reduce((sum, r) => sum + r._count._all, 0);
      const urgent = rows
        .filter((r) => r.priority === Priority.URGENT || r.priority === Priority.HIGH)
        .reduce((sum, r) => sum + r._count._all, 0);

      return {
        user: m.user,
        open: total,
        urgent,
        overdue: overdueByUser.get(m.userId) ?? 0,
      };
    });

    return {
      counts: { open, overdue, dueThisWeek, completedThisWeek },
      byPriority: byPriority.map((r) => ({ priority: r.priority, count: r._count._all })),
      byStatus: byStatus.map((r) => ({ statusId: r.statusId, count: r._count._all })),
      workload: workload.sort((a, b) => b.open - a.open),
      upcoming,
      activity: activity.map((a) => ({
        id: a.id,
        type: a.type,
        message: a.message,
        taskId: a.taskId,
        createdAt: a.createdAt,
        actor: a.actor,
      })),
      reminders: reminders.map((r) => ({
        id: r.id,
        remindAt: r.remindAt,
        task: r.task,
      })),
    };
  }

  // ── Workload ────────────────────────────────────────────────────────────

  /**
   * Per-person, per-day load for the next few weeks. A task counts on every day
   * between its start and due date so the timeline shows pressure, not just a
   * deadline spike.
   */
  async workload(userId: string, workspaceId: string, rawDays = "14") {
    const { role } = await this.access.requireWorkspace(userId, workspaceId);
    const visibility = this.access.projectVisibilityFilter(userId, role);
    const span = Math.min(60, Math.max(7, Number.parseInt(rawDays, 10) || 14));

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + span - 1);
    end.setHours(23, 59, 59, 999);

    const projectScope = { workspaceId, archived: false, ...visibility };
    const openStatus = { category: { not: StatusCategory.DONE } } as const;

    const [members, tasks, overdueRows] = await Promise.all([
      this.prisma.membership.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        include: { user: { select: USER_FIELDS } },
      }),
      this.prisma.task.findMany({
        where: {
          project: projectScope,
          status: openStatus,
          OR: [
            { dueDate: { gte: start, lte: end } },
            { startDate: { gte: start, lte: end } },
            { AND: [{ startDate: { lte: end } }, { dueDate: { gte: start } }] },
          ],
        },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
        select: {
          id: true,
          number: true,
          title: true,
          priority: true,
          startDate: true,
          dueDate: true,
          plannedMinutes: true,
          assigneeId: true,
          project: { select: { id: true, name: true, key: true, color: true } },
          status: { select: { id: true, name: true, category: true } },
        },
      }),
      this.prisma.task.groupBy({
        by: ["assigneeId"],
        where: {
          project: projectScope,
          status: openStatus,
          dueDate: { lt: start },
          assigneeId: { not: null },
        },
        _count: { _all: true },
      }),
    ]);

    const overdueByUser = new Map(overdueRows.map((row) => [row.assigneeId, row._count._all]));
    const loadByUser = new Map<string, number[]>();
    for (const member of members) {
      loadByUser.set(member.userId, Array.from({ length: span }, () => 0));
    }

    const dayIndex = (date: Date) =>
      Math.round((startOfDay(date).getTime() - start.getTime()) / 86_400_000);
    const clamp = (value: number) => Math.max(0, Math.min(span - 1, value));

    const assignments = tasks
      .map((task) => {
        const from = task.startDate
          ? dayIndex(task.startDate)
          : task.dueDate
            ? dayIndex(task.dueDate) - 1
            : null;
        const to = task.dueDate
          ? dayIndex(task.dueDate)
          : task.startDate
            ? dayIndex(task.startDate) + 1
            : null;
        if (from === null || to === null) return null;

        const first = clamp(from);
        const last = clamp(Math.max(from, to));
        if (task.assigneeId) {
          const load = loadByUser.get(task.assigneeId);
          if (load) {
            for (let day = first; day <= last; day += 1) load[day] += 1;
          }
        }

        return {
          id: task.id,
          number: task.number,
          title: task.title,
          priority: task.priority,
          project: task.project,
          status: task.status,
          assigneeId: task.assigneeId,
          startDay: first,
          endDay: last,
          startDate: task.startDate,
          dueDate: task.dueDate,
          plannedMinutes: task.plannedMinutes,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const days = Array.from({ length: span }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return isoDay(date);
    });

    return {
      range: { start: days[0], end: days[days.length - 1], days },
      members: members.map((member) => {
        const load = loadByUser.get(member.userId) ?? [];
        return {
          user: member.user,
          role: member.role,
          overdue: overdueByUser.get(member.userId) ?? 0,
          total: load.reduce((sum, value) => sum + value, 0),
          peak: load.reduce((max, value) => Math.max(max, value), 0),
          load,
        };
      }),
      assignments,
    };
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  async listTags(userId: string, workspaceId: string) {
    await this.access.requireWorkspace(userId, workspaceId);

    return this.prisma.tag.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      include: { _count: { select: { tasks: true } } },
    });
  }

  async createTag(userId: string, workspaceId: string, dto: CreateTagDto) {
    await this.access.requireWorkspace(userId, workspaceId);
    const name = dto.name.trim();

    const clash = await this.prisma.tag.findFirst({
      where: { workspaceId, name: { equals: name, mode: "insensitive" } },
    });
    if (clash) throw new ConflictException(`The tag ${name} already exists`);

    return this.prisma.tag.create({
      data: { workspaceId, name, color: dto.color ?? "#8b93a1" },
    });
  }

  async removeTag(userId: string, tagId: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundException("Tag not found");

    await this.access.requireWorkspace(userId, tag.workspaceId);
    await this.prisma.tag.delete({ where: { id: tagId } });

    return { ok: true };
  }

  // ── Saved filters ───────────────────────────────────────────────────────

  async listFilters(userId: string, workspaceId: string, projectId?: string) {
    await this.access.requireWorkspace(userId, workspaceId);

    return this.prisma.filterPreset.findMany({
      where: { workspaceId, userId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "asc" },
    });
  }

  async createFilter(userId: string, workspaceId: string, dto: CreateFilterDto) {
    await this.access.requireWorkspace(userId, workspaceId);

    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, workspaceId },
        select: { id: true },
      });
      if (!project) throw new BadRequestException("That project is not in this workspace");
    }

    return this.prisma.filterPreset.create({
      data: {
        workspaceId,
        userId,
        projectId: dto.projectId ?? null,
        name: dto.name.trim(),
        state: dto.state,
      },
    });
  }

  async updateFilter(userId: string, presetId: string, dto: UpdateFilterDto) {
    const preset = await this.prisma.filterPreset.findUnique({ where: { id: presetId } });
    if (!preset) throw new NotFoundException("Saved filter not found");
    if (preset.userId !== userId) throw new BadRequestException("That saved filter is not yours");

    await this.access.requireWorkspace(userId, preset.workspaceId);

    return this.prisma.filterPreset.update({
      where: { id: presetId },
      data: { name: dto.name?.trim(), state: dto.state },
    });
  }

  async removeFilter(userId: string, presetId: string) {
    const preset = await this.prisma.filterPreset.findUnique({ where: { id: presetId } });
    if (!preset) throw new NotFoundException("Saved filter not found");
    if (preset.userId !== userId) throw new BadRequestException("That saved filter is not yours");

    await this.prisma.filterPreset.delete({ where: { id: presetId } });
    return { ok: true };
  }

  /** Called on sign-up: one workspace, one project, three illustrative tasks. */
  async createStarterWorkspace(userId: string, userName: string) {
    const firstName = userName.split(" ")[0] || "there";

    const workspace = await this.prisma.workspace.create({
      data: {
        name: `${firstName}'s workspace`,
        memberships: { create: { userId, role: Role.OWNER } },
      },
    });

    const project = await this.prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: "Website launch",
        key: "WEB",
        color: "#4f8cff",
        description: "Everything needed to ship the new marketing site.",
        statuses: { create: DEFAULT_STATUSES.map((s, i) => ({ ...s, position: i })) },
      },
      include: { statuses: { orderBy: { position: "asc" } } },
    });

    const [todo, doing, done] = project.statuses;

    await this.prisma.task.createMany({
      data: [
        {
          projectId: project.id,
          number: 1,
          title: "Write the homepage copy",
          description: "Hero headline, three feature blurbs, and a closing call to action.",
          statusId: todo.id,
          priority: Priority.HIGH,
          creatorId: userId,
          assigneeId: userId,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          position: 0,
        },
        {
          projectId: project.id,
          number: 2,
          title: "Build the pricing table",
          description: "Three tiers, monthly/annual toggle, responsive below 640px.",
          statusId: doing.id,
          priority: Priority.MEDIUM,
          creatorId: userId,
          assigneeId: userId,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          position: 0,
        },
        {
          projectId: project.id,
          number: 3,
          title: "Pick a domain",
          statusId: done.id,
          priority: Priority.LOW,
          creatorId: userId,
          assigneeId: userId,
          completedAt: new Date(),
          position: 0,
        },
      ],
    });

    await this.access.log(workspace.id, userId, "workspace.create", "created the workspace");

    return workspace;
  }
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isoDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
