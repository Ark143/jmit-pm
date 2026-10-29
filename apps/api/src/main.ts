import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Body parsing is registered by hand so the CSV import (up to 1 MB of text)
  // is not rejected by Express' 100 kB default.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Render terminates TLS in front of the container; trusting one proxy hop
  // gives rate limiting and logs the real client address.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(json({ limit: "2mb" }));
  app.use(urlencoded({ extended: true, limit: "2mb" }));

  // WEB_ORIGIN is a comma-separated allowlist, e.g. "https://ark143.github.io,http://localhost:5173"
  const origins = (process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length > 0 ? origins : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
  });

  // Let Render's stop signal close connections and the Prisma pool cleanly
  // instead of killing the process mid-write.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
}

void bootstrap();
