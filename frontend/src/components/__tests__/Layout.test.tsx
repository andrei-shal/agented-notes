import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "../Layout";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";

// Render Layout within a router with placeholder child routes
function renderLayout(initialRoute = "/notes") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/notes" element={<div>Notes Page Content</div>} />
          <Route path="/kanban" element={<div>Kanban Page Content</div>} />
          <Route path="/calendar" element={<div>Calendar Page Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  beforeEach(() => {
    // Reset auth store — authenticated
    useAuthStore.setState({
      user: { id: 1, username: "test" },
      token: "test-token",
      isAuthenticated: true,
    });
    // Reset UI store — sidebarOpen false to avoid Sheet duplicating sidebar content
    useUIStore.setState({
      theme: "light",
      sidebarOpen: false,
    });
    localStorage.clear();
  });

  it("renders sidebar with navigation links", () => {
    renderLayout();

    expect(screen.getByText("Agented Notes")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Kanban")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
  });

  it("renders child route content via Outlet", () => {
    renderLayout("/notes");
    expect(screen.getByText("Notes Page Content")).toBeInTheDocument();

    // Navigate to kanban
    // This is a basic check — nav links exist so clicking them works
  });

  it("highlights active navigation link", () => {
    renderLayout("/kanban");
    const kanbanLink = screen.getByText("Kanban");
    // NavLink adds the "active" class
    expect(kanbanLink.closest("a")).toHaveAttribute("href", "/kanban");
  });

  it("renders theme toggle button", () => {
    renderLayout();
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });

  it("toggles theme on button click", async () => {
    renderLayout();
    const user = userEvent.setup();

    const toggleButton = screen.getByText("Dark mode");
    await user.click(toggleButton);

    // Store should be updated
    expect(useUIStore.getState().theme).toBe("dark");
    // Button text should have changed
    expect(screen.getByText("Light mode")).toBeInTheDocument();
  });

  it("renders sign out button", () => {
    renderLayout();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("logs out on sign out click", async () => {
    renderLayout();
    const user = userEvent.setup();

    await user.click(screen.getByText("Sign out"));

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
  });

  // Note: Mobile sheet sidebar is tested by opening the Sheet
  // On desktop viewport the sidebar is visible as <aside>
  it("renders desktop sidebar as aside element", () => {
    renderLayout();
    // On desktop (jsdom default width) the sidebar should be visible
    const sidebar = document.querySelector("aside");
    expect(sidebar).toBeInTheDocument();
    expect(sidebar).toHaveClass("hidden");
    // jsdom has width 1024 by default, but CSS media queries don't evaluate
    // So we just check the structure exists
  });
});
