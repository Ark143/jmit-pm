import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { StatusCategory } from "@prisma/client";
import { AccessService } from "../common/access.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateProjectDto,
  CreateStatusDto,
  UpdateProjectDto,
  UpdateStatusDto,
} from "./projects.dto";

export const DEFAULT_STATUSES: Array<{ name: string; category: StatusCategory }> = [
  { name: "To do", category: StatusCategory.TODO },
  { name: "In progress", category: StatusCategory.IN_PROGRESS },
  { name: "Done", category: StatusCategory.DONE },
];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async create(userId: string, workspaceId: string, dto: CreateProjectDto) {
    await this.access.requireWorkspace(userId, workspaceId);

    const key = dto.key.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(key)) {
      throw new BadRequestException("Key must be 2–6 letters or digits, e.g. WEB");
    }

    const clash = await this.prisma.project.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
    });
    if (clash) throw new ConflictException(`A project already uses the key ${key}`);

    const project = await this.prisma.project.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        key,
        description: dto.description?.trim() || null,
        color: dto.color ?? "#4f8cff",
        statuses: { create: DEFAULT_STATUSES.map((s, i) => ({ ...s, position: i })) },
      },
      include: { statuses: { orderBy: { position: "asc" } } },
    });

    await this.access.log(workspaceId, userId, "project.create", `created project ${project.name}`);

    return project;
  }

  async detail(userId: string, projectId: string) {
    const { project } = await this.access.requireProject(userId, projectId);

    const [statuses, counts] = await Promise.all([
      this.prisma.status.findMany({
        where: { projectId },
        orderBy: { position: "asc" },
      }),
      this.prisma.task.groupBy({
        by: ["statusId"],
        where: { projectId },
        _count: { _all: true },
      }),
    ]);

    const countByStatus = new Map(counts.map((c) => [c.statusId, c._count._all]));

    return {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      key: project.key,
      color: project.color,
      description: project.description,
      createdAt: project.createdAt,
      statuses: statuses.map((s) => ({ ...s, taskCount: countByStatus.get(s.id) ?? 0 })),
      taskCount: statuses.reduce((sum, s) => sum + (countByStatus.get(s.id) ?? 0), 0),
    };
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        color: dto.color,
        archived: dto.archived,
      },
    });

    await this.access.log(workspaceId, userId, "project.update", `updated project ${project.name}`);

    return updated;
  }

  async remove(userId: string, projectId: string) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);
    await this.access.requireAdmin(userId, workspaceId);

    await this.prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    await this.access.log(workspaceId, userId, "project.archive", `archived project ${project.name}`);

    return { ok: true };
  }

  async addStatus(userId: string, projectId: string, dto: CreateStatusDto) {
    const { workspaceId } = await this.access.requireProject(userId, projectId);

    const last = await this.prisma.status.findFirst({
      where: { projectId },
      orderBy: { position: "desc" },
    });

    const status = await this.prisma.status.create({
      data: {
        projectId,
        name: dto.name.trim(),
        category: dto.category ?? StatusCategory.TODO,
        position: (last?.position ?? -1) + 1,
      },
    });

    await this.access.log(workspaceId, userId, "status.create", `added column ${status.name}`);
    return status;
  }

  async updateStatus(userId: string, statusId: string, dto: UpdateStatusDto) {
    const status = await this.prisma.status.findUnique({ where: { id: statusId } });
    if (!status) throw new NotFoundException("Column not found");

    const { workspaceId } = await this.access.requireProject(userId, status.projectId);

    const updated = await this.prisma.status.update({
      where: { id: statusId },
      data: { name: dto.name?.trim(), category: dto.category },
    });

    await this.access.log(workspaceId, userId, "status.update", `renamed column to ${updated.name}`);
    return updated;
  }

  async removeStatus(userId: string, statusId: string) {
    const status = await this.prisma.status.findUnique({ where: { id: statusId } });
    if (!status) throw new NotFoundException("Column not found");

    const { workspaceId } = await this.access.requireProject(userId, status.projectId);

    const remaining = await this.prisma.status.count({ where: { projectId: status.projectId } });
    if (remaining <= 1) {
      throw new BadRequestException("A project needs at least one column");
    }

    const taskCount = await this.prisma.task.count({ where: { statusId } });
    if (taskCount > 0) {
      throw new BadRequestException("Move the tasks out of this column before deleting it");
    }

    await this.prisma.status.delete({ where: { id: statusId } });
    await this.access.log(workspaceId, userId, "status.delete", `removed column ${status.name}`);

    return { ok: true };
  }
}
