import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Priority, Role, StatusCategory } from "@prisma/client";
import { AccessService } from "../common/access.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AddMemberDto,
  CreateFilterDto,
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

    const openTasks = await this.prisma.task.groupBy({
      by: ["projectId"],
      where: {
        project: { workspace: { memberships: { some: { userId } } }, archived: false },
        status: { category: { not: StatusCategory.DONE } },
      },
      _count: { _all: true },
    });

    const projects = await this.prisma.project.findMany({
      where: { workspace: { memberships: { some: { userId } } }, archived: false },
      select: { id: true, workspaceId: true },
    });

    const workspaceOfProject = new Map(projects.map((p) => [p.id, p.workspaceId]));
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
      projectCount: m.workspace._count.projects,
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

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: {
        memberships: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: USER_FIELDS } },
        },
        projects: {
          where: { archived: false },
          orderBy: { createdAt: "asc" },
          include: {
            statuses: { orderBy: { position: "asc" } },
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
      throw new NotFoundException("No account uses that email yet — ask them to sign up first");
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

    return { ok: true };
  }

  async dashboard(userId: string, workspaceId: string) {
    await this.access.requireWorkspace(userId, workspaceId);

    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const openWhere = {
      project: { workspaceId, archived: false },
      status: { category: { not: StatusCategory.DONE } },
    } as const;

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
            project: { workspaceId, archived: false },
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
          where: { project: { workspaceId, archived: false } },
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
          where: { userId, dismissed: false, task: { project: { workspaceId, archived: false } } },
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
