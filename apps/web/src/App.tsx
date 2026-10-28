import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { WorkspaceShell } from "./pages/WorkspaceShell";
import { Spinner } from "./ui";

export function App() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="boot">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }

  if (status === "anon") return <LoginPage />;

  return <WorkspaceShell />;
}
