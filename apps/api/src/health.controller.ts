import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "./prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Used by uptime checks and by the web app's "is the API awake?" banner.
   * Returns 503 when the database cannot answer, so a broken deploy is visible
   * instead of looking healthy just because the process is up.
   */
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const startedAt = Date.now();
    let database: "up" | "down" = "up";

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }

    res.status(database === "up" ? 200 : 503);

    return {
      ok: database === "up",
      database,
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }
}
