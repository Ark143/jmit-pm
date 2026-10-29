import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Project, Role, Task } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface WorkspaceAccess {
  workspaceId: string;
  role: Role;
}

export interface ProjectAccess extends WorkspaceAccess {
  project: Project;
}

export interface TaskAccess extends ProjectAccess {
  task: Task;
}

/**
 * Central place for "is this user allowed to touch this row?" checks.
 * Every service goes through here so permissions can't drift between modules.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireWorkspace(userId: string, workspaceId: string): Promise<WorkspaceAccess> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }

    return { workspaceId, role: membership.role };
  }

  async requireProject(userId: string, projectId: string): Promise<ProjectAccess> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");

    const access = await this.requireWorkspace(userId, project.workspaceId);
    await this.assertProjectVisible(userId, access.role, project);
    return { ...access, project };
  }

  async requireTask(userId: string, taskId: string): Promise<TaskAccess> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (!task) throw new NotFoundException("Task not found");

    const access = await this.requireWorkspace(userId, task.project.workspaceId);
    await this.assertProjectVisible(userId, access.role, task.project);
    return { ...access, project: task.project, task };
  }

  /**
   * Private projects act like a room with a guest list: admins and owners can
   * always walk in, everyone else needs an explicit ProjectMember row. We hide
   * the project instead of saying "forbidden" so a member can't probe for the
   * existence of projects they were not invited to.
   */
  async assertProjectVisible(userId: string, role: Role, project: Project) {
    if (project.visibility !== "PRIVATE" || role !== Role.MEMBER) return;

    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
    });
    if (!membership) throw new NotFoundException("Project not found");
  }

  /** Projects this user is allowed to see inside a workspace. */
  projectVisibilityFilter(userId: string, role: Role) {
    if (role !== Role.MEMBER) return {};
    return {
      OR: [
        { visibility: "WORKSPACE" as const },
        { members: { some: { userId } } },
      ],
    };
  }

  async requireAdmin(userId: string, workspaceId: string): Promise<WorkspaceAccess> {
    const access = await this.requireWorkspace(userId, workspaceId);
    if (access.role === Role.MEMBER) {
      throw new ForbiddenException("Only workspace admins can do that");
    }
    return access;
  }

  /** Logs a workspace-level activity entry, e.g. "Ana moved Checkout flow to Done". */
  async log(workspaceId: string, actorId: string, type: string, message: string, taskId?: string) {
    await this.prisma.activity.create({
      data: { workspaceId, actorId, type, message, taskId: taskId ?? null },
    });
  }
}
