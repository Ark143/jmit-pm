import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { LoginDto, RegisterDto } from "./auth.dto";

const PUBLIC_USER = {
  id: true,
  email: true,
  name: true,
  color: true,
  createdAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("That email is already registered");
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash,
        color: pickColor(email),
      },
      select: PUBLIC_USER,
    });

    // Every new account gets a populated workspace so the app is never empty.
    await this.workspaces.createStarterWorkspace(user.id, user.name);

    return this.session(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Wrong email or password");
    }

    return this.session({
      id: user.id,
      email: user.email,
      name: user.name,
      color: user.color,
      createdAt: user.createdAt,
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: PUBLIC_USER,
    });

    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    return {
      user,
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        role: m.role,
      })),
    };
  }

  private async session(user: {
    id: string;
    email: string;
    name: string;
    color: string;
    createdAt: Date;
  }) {
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { secret: process.env.JWT_SECRET, expiresIn: "30d" },
    );

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id },
      include: { workspace: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    return {
      token,
      user,
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        role: m.role,
      })),
    };
  }
}

const PALETTE = [
  "#4f8cff",
  "#f5734a",
  "#22b07d",
  "#a855f7",
  "#e5484d",
  "#0ea5e9",
  "#d4a017",
  "#ec4899",
];

function pickColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
