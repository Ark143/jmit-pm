import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Render puts Cloudflare in front of the container, and the proxied socket
 * address varies between edge nodes. Using it would scatter a single client's
 * requests across several counters, so the limit would rarely bite. The real
 * client is the first X-Forwarded-For hop (set by the edge, not the caller).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;

    const cf = headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return cf.trim();

    const forwarded = headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }

    return String(req.ip ?? "unknown");
  }
}
