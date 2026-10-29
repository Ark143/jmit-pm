import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { InvitesController } from "./invites.controller";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({
  imports: [NotificationsModule],
  controllers: [InvitesController, WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
