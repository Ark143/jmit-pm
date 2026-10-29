import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../auth";
import { ApiError } from "../api";
import { ErrorNote } from "../ui";

export function LoginPage() {
  const { login, register, sessionExpired } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth__pitch">
        <div className="brand brand--lg">
          <span className="brand__mark" aria-hidden="true" />
          JMIT PM
        </div>
        <h1>Every project, task, and deadline in one place.</h1>
        <p>
          Kanban boards, workload per person, time tracking, and a live activity feed — built for
          small teams that would rather ship than configure.
        </p>
        <ul className="auth__points">
          <li>Board, list, and calendar views</li>
          <li>Subtasks, comments, and time logs</li>
          <li>Roles: owner, admin, member</li>
        </ul>
      </section>

      <section className="auth__panel">
        <form className="card auth__form" onSubmit={onSubmit}>
          {sessionExpired ? (
            <p className="notice notice--warn" role="status">
              Your session ended. Sign in again to pick up where you left off.
            </p>
          ) : null}

          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "is-active" : ""}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={mode === "register" ? "is-active" : ""}
              onClick={() => setMode("register")}
            >
              Create account
            </button>
          </div>

          {mode === "register" ? (
            <label className="field">
              <span>Full name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoComplete="name"
                placeholder="Ada Lovelace"
              />
            </label>
          ) : null}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === "register" ? 8 : 1}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
            />
          </label>

          <ErrorNote message={error} />

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>

          <p className="auth__foot">
            {mode === "login"
              ? "New here? Your account comes with a sample project so there's nothing to set up."
              : "You'll land in a workspace with a sample project you can edit or delete."}
          </p>
        </form>
      </section>
    </div>
  );
}
