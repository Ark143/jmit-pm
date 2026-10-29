import { Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { JoinPage } from "./pages/JoinPage";
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

  return (
    <Routes>
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="*" element={status === "anon" ? <LoginPage /> : <WorkspaceShell />} />
    </Routes>
  );
}
