import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Spinner } from "../ui";
import type { InvitePreview } from "../types";

/**
 * Landing page for a shared invite link. Works before sign-in: it shows what
 * the link is, then lets the invitee sign in or create the account the invite
 * was addressed to, and only then joins the workspace.
 */
export function JoinPage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { status, user, login, register, refreshWorkspaces, logout, setActiveWorkspace } = useAuth();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setLoadError(null);

    api.invites
      .preview(token)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        if (data.status === "ACCEPTED") setMode("login");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "Could not read that invite");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function join() {
    const result = await api.invites.accept(token);
    setActiveWorkspace(result.workspace.id);
    await refreshWorkspaces();
    navigate("/", { replace: true });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;

    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await register(name, preview.email, password);
      } else {
        await login(preview.email, password);
      }
      await join();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onAccept() {
    setBusy(true);
    setError(null);
    try {
      await join();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the workspace");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="auth auth--solo">
        <div className="auth__card">
          <h1 className="auth__title">Invite link</h1>
          <ErrorNote message={loadError} />
          <button type="button" className="btn" onClick={() => navigate("/", { replace: true })}>
            Go to the app
          </button>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="boot">
        <Spinner label="Checking the invite…" />
      </div>
    );
  }

  const closed = preview.status !== "PENDING";
  const wrongAccount = status === "ready" && user !== null && user.email.toLowerCase() !== preview.email.toLowerCase();

  return (
    <div className="auth auth--solo">
      <div className="auth__card join">
        <span className="brand">
          <span className="brand__mark" aria-hidden="true" />
          JMIT PM
        </span>

        <h1 className="auth__title">Join {preview.workspaceName}</h1>
        <p className="auth__sub">
          {preview.inviterName} invited <strong>{preview.email}</strong> to join as{" "}
          <strong>{preview.role.toLowerCase()}</strong>.
        </p>

        {closed ? (
          <>
            <p className="error-note" role="status">
              {preview.status === "ACCEPTED"
                ? "This invite has already been used. Sign in to open the workspace."
                : "This invite was cancelled. Ask an admin for a new link."}
            </p>
            <button type="button" className="btn" onClick={() => navigate("/", { replace: true })}>
              Go to the app
            </button>
          </>
        ) : status === "anon" ? (
          <form className="stack" onSubmit={onSubmit}>
            <div className="tabs tabs--inline" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "is-active" : ""}
                onClick={() => setMode("register")}
              >
                Create account
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "is-active" : ""}
                onClick={() => setMode("login")}
              >
                I already have one
              </button>
            </div>

            {mode === "register" ? (
              <label className="field">
                <span>Your name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  autoComplete="name"
                  placeholder="Alex Rivera"
                />
              </label>
            ) : null}

            <label className="field">
              <span>Email</span>
              <input type="email" value={preview.email} readOnly />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                placeholder="At least 8 characters"
              />
            </label>

            <ErrorNote message={error} />

            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Joining…" : mode === "register" ? "Create account and join" : "Sign in and join"}
            </button>
          </form>
        ) : wrongAccount ? (
          <>
            <p className="error-note" role="status">
              You are signed in as {user.email}. This invite is for {preview.email}.
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                logout();
                setMode("login");
              }}
            >
              Sign out and use the invited address
            </button>
          </>
        ) : (
          <>
            <ErrorNote message={error} />
            <button type="button" className="btn btn--primary" onClick={() => void onAccept()} disabled={busy}>
              {busy ? "Joining…" : `Join ${preview.workspaceName}`}
            </button>
            <p className="hint">You are signed in as {user?.email}.</p>
          </>
        )}

        <p className="hint">
          Invite expires {new Date(preview.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.
        </p>
      </div>
    </div>
  );
}
