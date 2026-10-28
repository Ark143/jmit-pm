import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Global so every feature module can use JwtAuthGuard without importing this
 * module. AuthModule -> WorkspacesModule is the only direction, which keeps
 * the dependency graph acyclic.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), WorkspacesModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
