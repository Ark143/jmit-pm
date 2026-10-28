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
    return { ...access, project };
  }

  async requireTask(userId: string, taskId: string): Promise<TaskAccess> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (!task) throw new NotFoundException("Task not found");

    const access = await this.requireWorkspace(userId, task.project.workspaceId);
    return { ...access, project: task.project, task };
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
