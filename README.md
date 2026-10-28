# JMIT PM

A project management app: projects, tasks, Kanban board, workload, time tracking, and a workspace activity feed. NestJS + PostgreSQL on the back end, React + Vite on the front.

Built as an original implementation — not a clone of any commercial product.

```
apps/
  api/    NestJS + Prisma + PostgreSQL   (JWT auth, RBAC, REST)
  web/    React 19 + Vite + TypeScript   (static build, any host)
```

## What's implemented

**Projects & tasks**
- Projects with custom keys (`WEB-14`), colours, descriptions, archive
- Tasks: title, rich description, status, priority, assignee, start/due dates, estimate
- Subtasks (one level), comments, time logs (per user, per task)
- Per-project status columns with categories (To do / In progress / Done)

**Views**
- **Board** — drag and drop between columns, ordered by fractional position
- **List** — sortable table with inline priority and due-date flags
- **Calendar** — month grid keyed on due dates
- **Dashboard** — open / overdue / completed-this-week counters, workload per person, priority mix, upcoming deadlines, activity feed
- **My tasks** — assigned, created, overdue, and completed across every project

**Collaboration & access**
- Email + password auth, bcrypt hashing, JWT sessions (30 days)
- Workspaces with members and roles: `OWNER`, `ADMIN`, `MEMBER`
- Permission checks centralised in `AccessService` so no endpoint can drift
- Activity log for task moves, comments, member changes

## Not implemented (deliberately)

The reference product this was inspired by ships ~20 modules. This is the tasks/projects core, not the whole suite. Not included: CRM, calendar sync, file storage, chat, telephony, invoicing, automation rules, custom fields, webhooks, SSO, email notifications, realtime websocket updates, and granular per-field permissions.

## Run locally

Requirements: Node 20+, PostgreSQL 14+ (or Docker).

```bash
cp .env.example .env
# edit DATABASE_URL and JWT_SECRET in .env

npm install
npm run db:migrate          # applies prisma/migrations
npm run dev:api             # http://localhost:3000/api
npm run dev:web             # http://localhost:5173
```

With Docker for the database only:

```bash
docker compose up -d db
```

Register an account — you land in a workspace pre-populated with a sample project.

## Deploy

### 1. API + database → Render

The repo contains `render.yaml`. On Render: **New → Blueprint**, pick this repo, apply. That provisions:

- `jmit-pm-db` — managed PostgreSQL, `DATABASE_URL` injected automatically
- `jmit-pm-api` — Docker build of `apps/api`, migrations run on boot

Note the service URL, e.g. `https://jmit-pm-api.onrender.com`. Free instances sleep after 15 minutes of inactivity, so the first request after idle takes ~30s.

### 2. Frontend → GitHub Pages

Settings → **Pages** → Source: **GitHub Actions**.

Then add one repository variable: **Settings → Secrets and variables → Actions → Variables**

| Name | Value |
|---|---|
| `VITE_API_URL` | `https://jmit-pm-api.onrender.com/api` |

Push to `main` (or re-run the `Deploy web to GitHub Pages` workflow). The site appears at `https://<user>.github.io/<repo>/`.

The build uses relative asset paths and `HashRouter`, so it works on Pages without any rewrite rules.

### 3. CORS

`WEB_ORIGIN` on the API must list the Pages origin, comma-separated:

```
https://ark143.github.io,http://localhost:5173
```

Set it in the Render dashboard if you fork this to a different account.

## API surface

```
POST   /api/auth/register            → token + user + workspaces
POST   /api/auth/login
GET    /api/auth/me

GET    /api/workspaces               → memberships with counts
POST   /api/workspaces
GET    /api/workspaces/:id           → members, projects, statuses
GET    /api/workspaces/:id/dashboard → counters, workload, activity
GET    /api/workspaces/:id/tasks?scope=assigned|created|overdue|done
POST   /api/workspaces/:id/members
DELETE /api/workspaces/:id/members/:userId

POST   /api/workspaces/:wid/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id             → archive
POST   /api/projects/:id/statuses
PATCH  /api/statuses/:statusId
DELETE /api/statuses/:statusId

GET    /api/projects/:id/tasks?statusId&assigneeId&priority&q
POST   /api/projects/:id/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
PATCH  /api/tasks/:id/move           → { statusId, position }
DELETE /api/tasks/:id
POST   /api/tasks/:id/comments
DELETE /api/comments/:commentId
POST   /api/tasks/:id/time
```

Every route except `/api/health` and the two auth calls requires `Authorization: Bearer <token>`.

## Data model

`User` · `Workspace` · `Membership` (role) · `Project` · `Status` · `Task` (self-referencing for subtasks) · `Comment` · `TimeLog` · `Activity`

See `apps/api/prisma/schema.prisma`. Board ordering uses a `Float position` so a single task move writes one row.

## Scripts

| Command | Effect |
|---|---|
| `npm run dev:api` | NestJS watch mode |
| `npm run dev:web` | Vite dev server |
| `npm run build` | Build both workspaces |
| `npm run typecheck` | `tsc --noEmit` on both |
| `npm run db:migrate` | `prisma migrate deploy` |

## Licence

MIT
