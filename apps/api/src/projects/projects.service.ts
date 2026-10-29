import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CustomFieldType, Priority, ProjectVisibility, StatusCategory } from "@prisma/client";
import { AccessService } from "../common/access.service";
import { EventsService } from "../events/events.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateCustomFieldDto,
  CreateProjectDto,
  CreateStatusDto,
  CreateTemplateDto,
  ImportCsvDto,
  SetProjectMembersDto,
  UpdateCustomFieldDto,
  UpdateProjectDto,
  UpdateStatusDto,
} from "./projects.dto";

export const DEFAULT_STATUSES: Array<{ name: string; category: StatusCategory }> = [
  { name: "To do", category: StatusCategory.TODO },
  { name: "In progress", category: StatusCategory.IN_PROGRESS },
  { name: "Done", category: StatusCategory.DONE },
];

const USER_FIELDS = { id: true, name: true, email: true, color: true } as const;

/** Shape stored in ProjectTemplate.blueprint. Everything is optional so old templates still load. */
interface Blueprint {
  statuses?: Array<{ name: string; category?: StatusCategory; position?: number }>;
  customFields?: Array<{ name: string; type: CustomFieldType; options?: string[]; position?: number }>;
  tasks?: Array<{
    title: string;
    description?: string | null;
    priority?: Priority;
    statusIndex?: number;
    plannedMinutes?: number | null;
    tags?: string[];
  }>;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly events: EventsService,
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

    const blueprint = dto.templateId
      ? await this.loadBlueprint(workspaceId, dto.templateId)
      : null;

    const visibility = dto.visibility ?? ProjectVisibility.WORKSPACE;
    const memberIds =
      visibility === ProjectVisibility.PRIVATE
        ? await this.cleanMemberIds(workspaceId, [userId, ...(dto.memberIds ?? [])])
        : [];

    const statusSeeds =
      blueprint?.statuses?.length
        ? blueprint.statuses.map((status, index) => ({
            name: status.name,
            category: status.category ?? StatusCategory.TODO,
            position: status.position ?? index,
          }))
        : DEFAULT_STATUSES.map((status, index) => ({ ...status, position: index }));

    const project = await this.prisma.project.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        key,
        description: dto.description?.trim() || null,
        color: dto.color ?? "#4f8cff",
        visibility,
        statuses: { create: statusSeeds },
        ...(memberIds.length > 0
          ? { members: { create: memberIds.map((memberId) => ({ userId: memberId })) } }
          : {}),
      },
      include: { statuses: { orderBy: { position: "asc" } } },
    });

    if (blueprint) {
      await this.applyBlueprint(userId, workspaceId, project.id, project.statuses, blueprint);
    }

    await this.access.log(
      workspaceId,
      userId,
      "project.create",
      `created project ${project.name}${dto.templateId ? " from a template" : ""}`,
    );
    this.events.emit(workspaceId, "project.created");

    return project;
  }

  async detail(userId: string, projectId: string) {
    const { project } = await this.access.requireProject(userId, projectId);

    const [statuses, counts, customFields, members] = await Promise.all([
      this.prisma.status.findMany({
        where: { projectId },
        orderBy: { position: "asc" },
      }),
      this.prisma.task.groupBy({
        by: ["statusId"],
        where: { projectId },
        _count: { _all: true },
      }),
      this.prisma.customField.findMany({
        where: { projectId },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      }),
      this.prisma.projectMember.findMany({
        where: { projectId },
        include: { user: { select: USER_FIELDS } },
        orderBy: { createdAt: "asc" },
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
      visibility: project.visibility,
      createdAt: project.createdAt,
      statuses: statuses.map((s) => ({ ...s, taskCount: countByStatus.get(s.id) ?? 0 })),
      customFields,
      members: members.map((member) => member.user),
      taskCount: statuses.reduce((sum, s) => sum + (countByStatus.get(s.id) ?? 0), 0),
    };
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);

    if (dto.visibility !== undefined && dto.visibility !== project.visibility) {
      await this.access.requireAdmin(userId, workspaceId);
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        color: dto.color,
        archived: dto.archived,
        visibility: dto.visibility,
      },
    });

    if (dto.visibility !== undefined && dto.visibility !== project.visibility) {
      // Going public clears the guest list; going private keeps it for later.
      if (dto.visibility === ProjectVisibility.WORKSPACE) {
        await this.prisma.projectMember.deleteMany({ where: { projectId } });
      }
      await this.access.log(
        workspaceId,
        userId,
        "project.visibility",
        `made ${project.name} ${dto.visibility === ProjectVisibility.PRIVATE ? "private" : "visible to the workspace"}`,
      );
    }

    await this.access.log(workspaceId, userId, "project.update", `updated project ${project.name}`);
    this.events.emit(workspaceId, "project.changed");

    return updated;
  }

  async remove(userId: string, projectId: string) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);
    await this.access.requireAdmin(userId, workspaceId);

    await this.prisma.project.update({ where: { id: projectId }, data: { archived: true } });
    await this.access.log(workspaceId, userId, "project.archive", `archived project ${project.name}`);
    this.events.emit(workspaceId, "project.changed");

    return { ok: true };
  }

  // ── Privacy: who can open a private project ─────────────────────────────

  async setMembers(userId: string, projectId: string, dto: SetProjectMembersDto) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);
    await this.access.requireAdmin(userId, workspaceId);

    if (project.visibility !== ProjectVisibility.PRIVATE) {
      throw new BadRequestException("Make the project private before choosing who can see it");
    }

    const userIds = await this.cleanMemberIds(workspaceId, dto.userIds);
    if (userIds.length === 0) {
      throw new BadRequestException("A private project needs at least one person who can see it");
    }

    await this.prisma.$transaction([
      this.prisma.projectMember.deleteMany({ where: { projectId } }),
      this.prisma.projectMember.createMany({
        data: userIds.map((memberId) => ({ projectId, userId: memberId })),
      }),
    ]);

    await this.access.log(
      workspaceId,
      userId,
      "project.members",
      `set who can see ${project.name} (${userIds.length} people)`,
    );
    this.events.emit(workspaceId, "project.changed");

    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: USER_FIELDS } },
      orderBy: { createdAt: "asc" },
    });

    return members.map((member) => member.user);
  }

  // ── Templates ───────────────────────────────────────────────────────────

  async listTemplates(userId: string, workspaceId: string) {
    await this.access.requireWorkspace(userId, workspaceId);

    return this.prisma.projectTemplate.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: USER_FIELDS } },
    });
  }

  async saveTemplate(userId: string, projectId: string, dto: CreateTemplateDto) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);

    const [statuses, customFields, tasks] = await Promise.all([
      this.prisma.status.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
      this.prisma.customField.findMany({
        where: { projectId },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      }),
      this.prisma.task.findMany({
        where: { projectId, parentId: null },
        orderBy: { number: "asc" },
        take: 30,
        include: { tags: { include: { tag: true } } },
      }),
    ]);

    const blueprint: Blueprint = {
      statuses: statuses.map((status) => ({
        name: status.name,
        category: status.category,
        position: status.position,
      })),
      customFields: customFields.map((field) => ({
        name: field.name,
        type: field.type,
        options: field.options,
        position: field.position,
      })),
      tasks: tasks.map((task) => ({
        title: task.title,
        description: task.description,
        priority: task.priority,
        statusIndex: Math.max(0, statuses.findIndex((status) => status.id === task.statusId)),
        plannedMinutes: task.plannedMinutes,
        tags: task.tags.map((row) => row.tag.name),
      })),
    };

    const template = await this.prisma.projectTemplate.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        blueprint: blueprint as object,
        createdById: userId,
      },
      include: { createdBy: { select: USER_FIELDS } },
    });

    await this.access.log(workspaceId, userId, "template.create", `saved template ${template.name}`);
    this.events.emit(workspaceId, "project.changed");

    return template;
  }

  async removeTemplate(userId: string, templateId: string) {
    const template = await this.prisma.projectTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException("Template not found");

    await this.access.requireAdmin(userId, template.workspaceId);
    await this.prisma.projectTemplate.delete({ where: { id: templateId } });
    this.events.emit(template.workspaceId, "project.changed");

    return { ok: true };
  }

  // ── CSV ─────────────────────────────────────────────────────────────────

  async exportCsv(userId: string, projectId: string) {
    const { project } = await this.access.requireProject(userId, projectId);

    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      orderBy: { number: "asc" },
      include: {
        status: { select: { name: true } },
        assignee: { select: { email: true } },
        tags: { include: { tag: { select: { name: true } } } },
      },
    });

    const header = [
      "number",
      "title",
      "status",
      "priority",
      "assignee",
      "startDate",
      "dueDate",
      "plannedMinutes",
      "tags",
      "description",
    ];

    const rows = tasks.map((task) => [
      String(task.number),
      task.title,
      task.status.name,
      task.priority,
      task.assignee?.email ?? "",
      dateOnly(task.startDate),
      dateOnly(task.dueDate),
      task.plannedMinutes === null ? "" : String(task.plannedMinutes),
      task.tags.map((row) => row.tag.name).join("; "),
      task.description ?? "",
    ]);

    return {
      filename: `${project.key.toLowerCase()}-tasks.csv`,
      csv: [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"),
    };
  }

  async importCsv(userId: string, projectId: string, dto: ImportCsvDto) {
    const { project, workspaceId } = await this.access.requireProject(userId, projectId);

    const rows = parseCsv(dto.csv);
    if (rows.length < 2) {
      throw new BadRequestException("Paste a header row plus at least one task");
    }

    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    const column = (name: string) => header.indexOf(name);
    const titleAt = column("title");
    if (titleAt < 0) {
      throw new BadRequestException('The CSV needs a "title" column');
    }

    const [statuses, memberships] = await Promise.all([
      this.prisma.status.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
      this.prisma.membership.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, email: true } } },
      }),
    ]);

    const last = await this.prisma.task.aggregate({
      where: { projectId },
      _max: { number: true },
    });
    let number = last._max.number ?? 0;

    const tagIds = new Map<string, string>();
    const existingTags = await this.prisma.tag.findMany({ where: { workspaceId } });
    for (const tag of existingTags) tagIds.set(tag.name.toLowerCase(), tag.id);

    const created: Array<{ id: string; number: number; title: string }> = [];
    const skipped: string[] = [];

    for (const row of rows.slice(1)) {
      const title = (row[titleAt] ?? "").trim();
      if (!title) continue;
      if (title.length > 200) {
        skipped.push(title.slice(0, 40));
        continue;
      }

      const statusName = cellAt(row, column("status")).toLowerCase();
      const status =
        statuses.find((candidate) => candidate.name.toLowerCase() === statusName) ?? statuses[0];

      const email = cellAt(row, column("assignee")).toLowerCase();
      const assignee = memberships.find(
        (membership) => membership.user.email.toLowerCase() === email,
      );

      const priorityText = cellAt(row, column("priority")).toUpperCase();
      const priority = (Object.values(Priority) as string[]).includes(priorityText)
        ? (priorityText as Priority)
        : Priority.MEDIUM;

      const planned = Number.parseInt(cellAt(row, column("plannedMinutes")), 10);
      const tagNames = splitTags(cellAt(row, column("tags")));

      number += 1;
      const task = await this.prisma.task.create({
        data: {
          projectId,
          number,
          title,
          description: cellAt(row, column("description")).trim() || null,
          statusId: status.id,
          priority,
          assigneeId: assignee?.userId ?? null,
          creatorId: userId,
          startDate: parseDate(cellAt(row, column("startDate"))),
          dueDate: parseDate(cellAt(row, column("dueDate"))),
          plannedMinutes: Number.isFinite(planned) && planned > 0 ? planned : null,
          position: created.length,
          tags: tagNames.length
            ? {
                create: await Promise.all(
                  tagNames.map(async (name) => ({
                    tagId: await this.ensureTag(workspaceId, name, tagIds),
                  })),
                ),
              }
            : undefined,
        },
        select: { id: true, number: true, title: true },
      });

      created.push(task);
    }

    await this.access.log(
      workspaceId,
      userId,
      "project.import",
      `imported ${created.length} task${created.length === 1 ? "" : "s"} into ${project.name}`,
    );
    this.events.emit(workspaceId, "task.created");

    return { created: created.length, skipped, tasks: created };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async loadBlueprint(workspaceId: string, templateId: string): Promise<Blueprint> {
    const template = await this.prisma.projectTemplate.findFirst({
      where: { id: templateId, workspaceId },
    });
    if (!template) throw new NotFoundException("Template not found");

    return (template.blueprint ?? {}) as Blueprint;
  }

  /** Keeps only real workspace members, de-duplicated, preserving order. */
  private async cleanMemberIds(workspaceId: string, userIds: string[]) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return [];

    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId, userId: { in: unique } },
      select: { userId: true },
    });
    const allowed = new Set(memberships.map((row) => row.userId));

    return unique.filter((id) => allowed.has(id));
  }

  private async applyBlueprint(
    userId: string,
    workspaceId: string,
    projectId: string,
    statuses: Array<{ id: string }>,
    blueprint: Blueprint,
  ) {
    if (blueprint.customFields?.length) {
      await this.prisma.customField.createMany({
        data: blueprint.customFields.slice(0, 20).map((field, index) => ({
          projectId,
          name: field.name.slice(0, 60),
          type: field.type,
          options: cleanOptions(field.options),
          position: field.position ?? index,
        })),
      });
    }

    if (!blueprint.tasks?.length) return;

    const tagIds = new Map<string, string>();
    let position = 0;

    for (const seed of blueprint.tasks.slice(0, 30)) {
      const title = seed.title?.trim();
      if (!title) continue;

      const status = statuses[Math.min(seed.statusIndex ?? 0, statuses.length - 1)] ?? statuses[0];
      const tagNames = splitTags((seed.tags ?? []).join(";"));

      await this.prisma.task.create({
        data: {
          projectId,
          number: position + 1,
          title: title.slice(0, 200),
          description: seed.description?.trim() || null,
          statusId: status.id,
          priority: seed.priority ?? Priority.MEDIUM,
          creatorId: userId,
          plannedMinutes: seed.plannedMinutes ?? null,
          position,
          tags: tagNames.length
            ? {
                create: await Promise.all(
                  tagNames.map(async (name) => ({
                    tagId: await this.ensureTag(workspaceId, name, tagIds),
                  })),
                ),
              }
            : undefined,
        },
      });

      position += 1;
    }
  }

  /** Look up a tag by name, creating it on first use. */
  private async ensureTag(workspaceId: string, rawName: string, cache: Map<string, string>) {
    const name = rawName.trim().slice(0, 40);
    const cacheKey = name.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const existing = await this.prisma.tag.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
    if (existing) {
      cache.set(cacheKey, existing.id);
      return existing.id;
    }

    const tag = await this.prisma.tag.create({ data: { workspaceId, name } });
    cache.set(cacheKey, tag.id);
    return tag.id;
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

  // ── Custom fields ───────────────────────────────────────────────────────

  async listFields(userId: string, projectId: string) {
    await this.access.requireProject(userId, projectId);

    return this.prisma.customField.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
  }

  async addField(userId: string, projectId: string, dto: CreateCustomFieldDto) {
    const { workspaceId } = await this.access.requireProject(userId, projectId);
    const name = dto.name.trim();

    if (dto.type === CustomFieldType.SELECT && (dto.options ?? []).length === 0) {
      throw new BadRequestException("A dropdown field needs at least one option");
    }

    const clash = await this.prisma.customField.findFirst({
      where: { projectId, name: { equals: name, mode: "insensitive" } },
    });
    if (clash) throw new ConflictException(`This project already has a field called ${name}`);

    const last = await this.prisma.customField.findFirst({
      where: { projectId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const field = await this.prisma.customField.create({
      data: {
        projectId,
        name,
        type: dto.type,
        options: cleanOptions(dto.options),
        position: (last?.position ?? -1) + 1,
      },
    });

    await this.access.log(workspaceId, userId, "field.create", `added field ${field.name}`);
    return field;
  }

  async updateField(userId: string, fieldId: string, dto: UpdateCustomFieldDto) {
    const field = await this.prisma.customField.findUnique({ where: { id: fieldId } });
    if (!field) throw new NotFoundException("Field not found");

    const { workspaceId } = await this.access.requireProject(userId, field.projectId);

    const nextType = dto.type ?? field.type;
    const nextOptions = dto.options === undefined ? field.options : cleanOptions(dto.options);
    if (nextType === CustomFieldType.SELECT && nextOptions.length === 0) {
      throw new BadRequestException("A dropdown field needs at least one option");
    }

    const updated = await this.prisma.customField.update({
      where: { id: fieldId },
      data: {
        name: dto.name?.trim(),
        type: dto.type,
        options: dto.options === undefined ? undefined : nextOptions,
        position: dto.position,
      },
    });

    await this.access.log(workspaceId, userId, "field.update", `updated field ${updated.name}`);
    return updated;
  }

  async removeField(userId: string, fieldId: string) {
    const field = await this.prisma.customField.findUnique({ where: { id: fieldId } });
    if (!field) throw new NotFoundException("Field not found");

    const { workspaceId } = await this.access.requireProject(userId, field.projectId);
    await this.prisma.customField.delete({ where: { id: fieldId } });
    await this.access.log(workspaceId, userId, "field.delete", `removed field ${field.name}`);

    return { ok: true };
  }
}

function cleanOptions(options?: string[]) {
  return [...new Set((options ?? []).map((o) => o.trim()).filter(Boolean))];
}

function csvCell(value: string) {
  const escaped = value.replace(/"/g, '""');
  return /[",\r\n]/.test(value) ? `"${escaped}"` : escaped;
}

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function cellAt(row: string[], index: number) {
  return index < 0 ? "" : (row[index] ?? "");
}

function splitTags(value: string) {
  return [...new Set(value.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean))];
}

function parseDate(value: string) {
  const text = value.trim();
  if (!text) return null;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Small RFC-4180 reader: quoted cells, escaped quotes, CRLF or LF, blank lines dropped. */
function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r") {
      // Ignore; the \n that follows closes the row.
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((line) => line.some((value) => value.trim().length > 0));
}
