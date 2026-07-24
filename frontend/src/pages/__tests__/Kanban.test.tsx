import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { KanbanBoardListItem, KanbanBoardWithColumns } from "@/lib/api";

// Data helpers
function makeBoardListItem(overrides: Partial<KanbanBoardListItem> = {}): KanbanBoardListItem {
  return {
    id: "board-1",
    name: "My Board",
    description: "A test board",
    createdAt: "2025-01-01T00:00:00Z",
    columns: [
      { id: "col-1", name: "To Do", position: 0, color: null, taskCount: 2 },
      { id: "col-2", name: "In Progress", position: 1, color: null, taskCount: 1 },
      { id: "col-3", name: "Done", position: 2, color: null, taskCount: 0 },
    ],
    ...overrides,
  };
}

function makeBoardDetail(overrides: Partial<KanbanBoardWithColumns> = {}): KanbanBoardWithColumns {
  return {
    id: "board-1",
    name: "My Board",
    description: "A test board",
    createdAt: "2025-01-01T00:00:00Z",
    columns: [
      {
        id: "col-1",
        boardId: "board-1",
        name: "To Do",
        position: 0,
        color: null,
        createdAt: "2025-01-01T00:00:00Z",
        tasks: [
          {
            id: "task-1",
            columnId: "col-1",
            title: "First task",
            description: "First description",
            position: 0,
            dueDate: "2025-12-31",
            tags: ["feature"],
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
          {
            id: "task-2",
            columnId: "col-1",
            title: "Second task",
            description: null,
            position: 1,
            dueDate: null,
            tags: [],
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      },
      {
        id: "col-2",
        boardId: "board-1",
        name: "In Progress",
        position: 1,
        color: null,
        createdAt: "2025-01-01T00:00:00Z",
        tasks: [
          {
            id: "task-3",
            columnId: "col-2",
            title: "Active task",
            description: "Working on this",
            position: 0,
            dueDate: null,
            tags: ["bug"],
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      },
      {
        id: "col-3",
        boardId: "board-1",
        name: "Done",
        position: 2,
        color: null,
        createdAt: "2025-01-01T00:00:00Z",
        tasks: [],
      },
    ],
    ...overrides,
  };
}

// ── MSW server ──────────────────────────────────────────────────────────────

const handlers = [
  http.get("/api/kanban/boards", () => {
    return HttpResponse.json([makeBoardListItem()]);
  }),

  http.get("/api/kanban/boards/:id", ({ params }) => {
    if (params["id"] === "board-1") {
      return HttpResponse.json(makeBoardDetail());
    }
    return HttpResponse.json({ error: "Not found" }, { status: 404 });
  }),

  http.post("/api/kanban/boards", async ({ request }) => {
    const body = await request.json() as { name: string; description?: string | null };
    return HttpResponse.json(
      makeBoardDetail({ name: body.name, description: body.description ?? null }),
      { status: 201 },
    );
  }),

  http.post("/api/kanban/boards/:boardId/columns", async ({ request }) => {
    const body = await request.json() as { name: string };
    return HttpResponse.json(
      {
        id: "col-new",
        boardId: "board-1",
        name: body.name,
        position: 3,
        color: null,
        createdAt: "2025-01-01T00:00:00Z",
        tasks: [],
      },
      { status: 201 },
    );
  }),

  http.post("/api/kanban/boards/:boardId/columns/:columnId/tasks", async ({ params, request }) => {
    const body = await request.json() as { title: string; description?: string | null; dueDate?: string | null; tags?: string[] };
    return HttpResponse.json(
      {
        id: "task-new",
        columnId: params["columnId"],
        title: body.title,
        description: body.description ?? null,
        position: 0,
        dueDate: body.dueDate ?? null,
        tags: body.tags ?? [],
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      { status: 201 },
    );
  }),

  http.put("/api/kanban/tasks/:id", async ({ params, request }) => {
    const body = await request.json() as { title?: string };
    return HttpResponse.json({
      id: params["id"],
      columnId: "col-1",
      title: body.title ?? "Updated",
      description: "Updated description",
      position: 0,
      dueDate: null,
      tags: [],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    });
  }),

  http.delete("/api/kanban/tasks/:id", () => {
    return HttpResponse.json({ message: "Task deleted" });
  }),

  http.patch("/api/kanban/tasks/:id/move", ({ params }) => {
    return HttpResponse.json({
      id: params["id"],
      columnId: "col-2",
      title: "Moved task",
      description: null,
      position: 0,
      dueDate: null,
      tags: [],
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    });
  }),
];

const server = setupServer(...handlers);

// ── Helpers ─────────────────────────────────────────────────────────────────

// We render Kanban directly but need to be inside a router context since
// Kanban doesn't use routing itself (the page is routed by App.tsx).
// Kanban reads from URL params? No — it uses internal state, so a MemoryRouter wrapper is enough.
import { MemoryRouter } from "react-router-dom";
import Kanban from "../Kanban";

function renderKanban() {
  return render(
    <MemoryRouter>
      <Kanban />
    </MemoryRouter>,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Kanban", () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  // ── Board list ──────────────────────────────────────────────────────────

  it("renders board list with boards from API", async () => {
    renderKanban();
    expect(await screen.findByText("My Board")).toBeInTheDocument();
    expect(screen.getByText("A test board")).toBeInTheDocument();
    expect(screen.getByText("3 tasks")).toBeInTheDocument();
    expect(screen.getByText("3 columns")).toBeInTheDocument();
  });

  it("shows empty state when no boards exist", async () => {
    server.use(
      http.get("/api/kanban/boards", () => {
        return HttpResponse.json([]);
      }),
    );
    renderKanban();
    expect(await screen.findByText("No boards yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first board"),
    ).toBeInTheDocument();
  });

  it("opens create board dialog and creates a board", async () => {
    renderKanban();
    const user = userEvent.setup();

    // Open dialog
    await user.click(screen.getByText("New board"));
    expect(screen.getByText("Create a kanban board to organize your tasks.")).toBeInTheDocument();

    // Fill form
    await user.type(screen.getByPlaceholderText("Board name"), "New Test Board");
    await user.click(screen.getByText("Create board"));

    // After creation, board list refreshes
    expect(await screen.findByText("My Board")).toBeInTheDocument();
  });

  // ── Board detail ────────────────────────────────────────────────────────

  it("opens board detail when clicking a board card", async () => {
    renderKanban();
    const user = userEvent.setup();

    await user.click(await screen.findByText("My Board"));

    // Should see column headers
    expect(await screen.findByText("To Do")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    // Should see tasks in columns
    expect(screen.getByText("First task")).toBeInTheDocument();
    expect(screen.getByText("Second task")).toBeInTheDocument();
    expect(screen.getByText("Active task")).toBeInTheDocument();

    // Should see task count badges
    const todoColumn = screen.getByText("To Do").closest("[class*='rounded-t-xl']")!;
    expect(todoColumn).toHaveTextContent("2");
  });

  it("shows description preview, due date, and tags on task cards", async () => {
    renderKanban();
    const user = userEvent.setup();
    await user.click(await screen.findByText("My Board"));

    // Wait for board to load
    expect(await screen.findByText("First task")).toBeInTheDocument();

    // Description preview
    expect(screen.getByText("First description")).toBeInTheDocument();

    // Tags
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();

    // Due date badge (Dec 31)
    expect(screen.getByText("Dec 31")).toBeInTheDocument();
  });

  it("navigates back to board list", async () => {
    renderKanban();
    const user = userEvent.setup();

    await user.click(await screen.findByText("My Board"));
    expect(await screen.findByText("To Do")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Back to boards"));
    expect(await screen.findByText("Kanban boards")).toBeInTheDocument();
  });

  it("adds a new column", async () => {
    renderKanban();
    const user = userEvent.setup();

    await user.click(await screen.findByText("My Board"));
    expect(await screen.findByText("To Do")).toBeInTheDocument();

    // Click "Column" button to add column
    await user.click(screen.getByText("Column"));
    expect(screen.getByRole("heading", { name: "Add column" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Column name"), "Review");
    await user.click(screen.getByRole("button", { name: "Add column" }));
  });

  // ── Task editing ────────────────────────────────────────────────────────

  it("opens task edit dialog on task click", async () => {
    renderKanban();
    const user = userEvent.setup();

    await user.click(await screen.findByText("My Board"));
    expect(await screen.findByText("First task")).toBeInTheDocument();

    await user.click(screen.getByText("First task"));
    expect(screen.getByText("Edit task")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("Task title") as HTMLInputElement;
    expect(input.value).toBe("First task");
  });

  it("saves edited task", async () => {
    renderKanban();
    const user = userEvent.setup();

    await user.click(await screen.findByText("My Board"));
    expect(await screen.findByText("First task")).toBeInTheDocument();

    await user.click(screen.getByText("First task"));
    const input = screen.getByPlaceholderText("Task title") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Updated first task");
    await user.click(screen.getByText("Save"));

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByText("Edit task")).not.toBeInTheDocument();
    });
  });

  it("deletes a task", async () => {
    renderKanban();
    const user = userEvent.setup();

    await user.click(await screen.findByText("My Board"));
    expect(await screen.findByText("First task")).toBeInTheDocument();

    await user.click(screen.getByText("First task"));
    await user.click(screen.getByText("Delete"));

    await waitFor(() => {
      expect(screen.queryByText("Edit task")).not.toBeInTheDocument();
    });
  });

  // ── Add task ────────────────────────────────────────────────────────────

  it("adds a task to a column", async () => {
    renderKanban();
    const user = userEvent.setup();

    await user.click(await screen.findByText("My Board"));
    expect(await screen.findByText("To Do")).toBeInTheDocument();

    // Find the first "Add task" button (from the first column)
    const addTaskButtons = screen.getAllByRole("button", { name: /add task/i });
    await user.click(addTaskButtons[0]!);

    // Dialog title
    expect(screen.getByRole("heading", { name: "Add task" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Task title"), "Newly added task");
    // Submit button inside the dialog
    const submitButtons = screen.getAllByRole("button", { name: /add task/i });
    await user.click(submitButtons[submitButtons.length - 1]!);

    // Dialog should close — the heading should be gone
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Add task" })).not.toBeInTheDocument();
    });
  });
});
