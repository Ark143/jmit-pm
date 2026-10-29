-- Phase 5: indexes for the queries the UI runs on every page load.
-- IF NOT EXISTS keeps this safe if an index was created manually on the DB.

CREATE INDEX IF NOT EXISTS "Task_projectId_dueDate_idx" ON "Task"("projectId", "dueDate");
CREATE INDEX IF NOT EXISTS "Activity_taskId_createdAt_idx" ON "Activity"("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_workspaceId_createdAt_idx" ON "Notification"("userId", "workspaceId", "createdAt");
