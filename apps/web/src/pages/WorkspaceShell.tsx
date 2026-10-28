import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { Avatar, EmptyState, Spinner } from "../ui";
import type { WorkspaceDetail } from "../types";
import { DashboardPage } from "./DashboardPage";
import { MembersModal } from "./MembersModal";
import { MyTasksPage } from "./MyTasksPage";
import { NewProjectModal } from "./NewProjectModal";
import { ProjectPage } from "./ProjectPage";

export function WorkspaceShell() {
  const {
    user,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    logout,
    refreshWorkspaces,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      setError(null);
      const detail = await api.workspaces.get(activeWorkspaceId);
      setWorkspace(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the workspace");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  if (!activeWorkspaceId || workspaces.length === 0) {
    return (
      <div className="boot">
        <EmptyState
          title="No workspace yet"
          body="Something went wrong creating your workspace. Sign out and register again."
          action={
            <button type="button" className="btn" onClick={logout}>
              Sign out
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? "is-open" : ""}`} aria-label="Workspace navigation">
        <div className="sidebar__head">
          <span className="brand">
            <span className="brand__mark" aria-hidden="true" />
            JMIT PM
          </span>
          <button
            type="button"
            className="icon-btn sidebar__close"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            ✕
          </button>
        </div>

        <label className="field field--tight">
          <span className="sr-only">Workspace</span>
          <select
            value={activeWorkspaceId}
            onChange={(event) => {
              setActiveWorkspace(event.target.value);
              navigate("/");
            }}
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
        </label>

        <nav className="nav">
          <Link to="/" className={location.pathname === "/" ? "nav__item is-active" : "nav__item"}>
            <span className="nav__icon" aria-hidden="true">
              ◧
            </span>
            Dashboard
          </Link>
          <Link
            to="/tasks"
            className={location.pathname === "/tasks" ? "nav__item is-active" : "nav__item"}
          >
            <span className="nav__icon" aria-hidden="true">
              ✓
            </span>
            My tasks
          </Link>
        </nav>

        <div className="sidebar__section">
          <span className="sidebar__label">Projects</span>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={() => setProjectModalOpen(true)}
            aria-label="New project"
            title="New project"
          >
            +
          </button>
        </div>

        <ul className="project-list">
          {workspace?.projects.map((project) => {
            const active = location.pathname === `/p/${project.id}`;
            const pct = project.taskCount ? Math.round((project.doneCount / project.taskCount) * 100) : 0;
            return (
              <li key={project.id}>
                <Link
                  to={`/p/${project.id}`}
                  className={active ? "project-link is-active" : "project-link"}
                >
                  <span className="project-dot" style={{ background: project.color }} />
                  <span className="project-link__name">{project.name}</span>
                  <span className="project-link__meta">{pct}%</span>
                </Link>
              </li>
            );
          })}
          {workspace && workspace.projects.length === 0 ? (
            <li className="project-list__empty">No projects yet</li>
          ) : null}
        </ul>

        <div className="sidebar__foot">
          <button type="button" className="nav__item" onClick={() => setMembersOpen(true)}>
            <span className="nav__icon" aria-hidden="true">
              ⚇
            </span>
            Members
            <span className="pill">{workspace?.members.length ?? 0}</span>
          </button>

          {user ? (
            <div className="user-row">
              <Avatar user={user} size={30} />
              <div className="user-row__text">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <button type="button" className="icon-btn icon-btn--sm" onClick={logout} title="Sign out">
                ⏻
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar__menu"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            ☰
          </button>
          <div className="topbar__crumb">
            <span className="topbar__workspace">{workspace?.name ?? "Workspace"}</span>
          </div>
          <div className="topbar__actions">
            {workspace && workspace.members.length > 1 ? (
              <div className="avatar-stack">
                {workspace.members.slice(0, 4).map((member) => (
                  <Avatar key={member.user.id} user={member.user} size={24} />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setProjectModalOpen(true)}
            >
              New project
            </button>
          </div>
        </header>

        <div className="content">
          {loading ? (
            <Spinner label="Loading workspace…" />
          ) : error ? (
            <EmptyState
              title="Can't load this workspace"
              body={error}
              action={
                <button type="button" className="btn" onClick={() => void load()}>
                  Retry
                </button>
              }
            />
          ) : workspace ? (
            <Routes>
              <Route path="/" element={<DashboardPage workspace={workspace} />} />
              <Route path="/tasks" element={<MyTasksPage workspace={workspace} />} />
              <Route
                path="/p/:projectId"
                element={<ProjectPage workspace={workspace} onWorkspaceChange={load} />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          ) : null}
        </div>
      </main>

      <MembersModal
        open={membersOpen}
        workspace={workspace}
        onClose={() => setMembersOpen(false)}
        onChanged={load}
      />

      <NewProjectModal
        open={projectModalOpen}
        workspaceId={activeWorkspaceId}
        onClose={() => setProjectModalOpen(false)}
        onCreated={async (projectId) => {
          await Promise.all([load(), refreshWorkspaces()]);
          navigate(`/p/${projectId}`);
        }}
      />
    </div>
  );
}
