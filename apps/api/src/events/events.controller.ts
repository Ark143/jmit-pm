import {
  Controller,
  Param,
  Query,
  Res,
  Sse,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Response } from "express";
import { AccessService } from "../common/access.service";
import { EventsService } from "./events.service";

interface JwtPayload {
  sub: string;
  email: string;
}

@Controller()
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly access: AccessService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * EventSource cannot send headers, so the stream takes the token as a query
   * parameter and verifies it by hand before subscribing.
   */
  @Sse("workspaces/:id/stream")
  async stream(
    @Param("id") workspaceId: string,
    @Query("token") token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token) throw new UnauthorizedException("Missing stream token");

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException("Invalid stream token");
    }

    await this.access.requireWorkspace(payload.sub, workspaceId);

    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");

    return this.events.subscribe(workspaceId);
  }
}
