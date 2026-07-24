import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import Layout from "./components/Layout";
import Notes from "./pages/Notes";
import NoteDetail from "./pages/NoteDetail";
import Kanban from "./pages/Kanban";
import CalendarPage from "./pages/Calendar";
import Login from "./pages/Login";
import type { ReactNode } from "react";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const initializing = useAuthStore((s) => s.initializing);

  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Restoring session...</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/notes" element={<Notes />} />
          <Route path="/notes/:id" element={<NoteDetail />} />
          <Route path="/kanban" element={<Kanban />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/" element={<Navigate to="/notes" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/notes" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
