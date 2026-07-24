import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import Notes from "../Notes";
import { useFilterStore } from "@/store/filterStore";

// ── Sample data ─────────────────────────────────────────────────────────────

const sampleNotes = [
  {
    id: "note-1",
    title: "Meeting Notes",
    content: "Discuss #project #design",
    createdAt: "2025-07-24T10:00:00.000Z",
    updatedAt: "2025-07-24T10:00:00.000Z",
    tags: ["project", "design"],
  },
  {
    id: "note-2",
    title: "Shopping List",
    content: "Buy milk and eggs",
    createdAt: "2025-07-23T14:00:00.000Z",
    updatedAt: "2025-07-23T14:00:00.000Z",
    tags: ["personal"],
  },
];

// ── MSW handlers ────────────────────────────────────────────────────────────

const handlers = [
  http.get("/api/notes", ({ request }) => {
    const url = new URL(request.url);
    const tag = url.searchParams.get("tag");
    const search = url.searchParams.get("search");
    let filtered = [...sampleNotes];
    if (tag) {
      filtered = filtered.filter((n) => n.tags.includes(tag));
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q),
      );
    }
    return HttpResponse.json({ notes: filtered, total: filtered.length });
  }),

  http.post("/api/notes", async ({ request }) => {
    const body = (await request.json()) as { title: string; content?: string };
    const newNote = {
      id: "note-new",
      title: body.title,
      content: body.content ?? "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
    };
    return HttpResponse.json(newNote, { status: 201 });
  }),
];

const server = setupServer(...handlers);

// ── Router wrapper ──────────────────────────────────────────────────────────

import { Routes, Route } from "react-router-dom";

function renderNotes(initialRoute = "/notes") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/notes" element={<Notes />} />
        <Route
          path="/notes/:id"
          element={<div data-testid="note-detail-mock">Note Detail</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe("Notes", () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: "bypass" });
    useFilterStore.setState({ activeTag: null });
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
    vi.restoreAllMocks();
  });

  // ── List ────────────────────────────────────────────────────────────

  it("renders the Notes heading", () => {
    renderNotes();
    expect(
      screen.getByRole("heading", { name: /notes/i }),
    ).toBeInTheDocument();
  });

  it("fetches and displays notes from API", async () => {
    renderNotes();

    expect(await screen.findByText("Meeting Notes")).toBeInTheDocument();
    expect(screen.getByText("Shopping List")).toBeInTheDocument();
  });

  it("renders tag badges for each note's tags", async () => {
    renderNotes();

    // Tags appear both in the tag cloud AND in the note cards.
    // Use aria-label to pick card-level instances uniquely.
    expect(await screen.findByRole("button", { name: /filter by tag: project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filter by tag: design/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filter by tag: personal/i })).toBeInTheDocument();
  });

  it("shows loading indicator while fetching", () => {
    renderNotes();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  // ── Empty state ─────────────────────────────────────────────────────

  it("shows empty state when no notes exist", async () => {
    server.use(
      http.get("/api/notes", () => {
        return HttpResponse.json({ notes: [], total: 0 });
      }),
    );

    renderNotes();

    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first note"),
    ).toBeInTheDocument();
  });

  // ── Search ──────────────────────────────────────────────────────────

  it("filters notes by search query", async () => {
    renderNotes();

    // Wait for initial load
    expect(await screen.findByText("Meeting Notes")).toBeInTheDocument();

    const user = userEvent.setup();
    const searchInput = screen.getByPlaceholderText("Search notes…");
    await user.type(searchInput, "Shopping");

    // After debounce, only Shopping List should appear
    await waitFor(() => {
      expect(screen.queryByText("Meeting Notes")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Shopping List")).toBeInTheDocument();
  });

  it("shows empty search result message", async () => {
    renderNotes();
    expect(await screen.findByText("Meeting Notes")).toBeInTheDocument();

    const user = userEvent.setup();
    const searchInput = screen.getByPlaceholderText("Search notes…");
    await user.type(searchInput, "zzz_nonexistent_zzz");

    await waitFor(() => {
      expect(
        screen.getByText("No notes match your search"),
      ).toBeInTheDocument();
    });
  });

  // ── Tag filtering ───────────────────────────────────────────────────

  it("filters by tag when a tag chip is clicked", async () => {
    renderNotes();

    // Wait for notes to load — both note cards are visible
    expect(await screen.findByText("Meeting Notes")).toBeInTheDocument();
    expect(screen.getByText("Shopping List")).toBeInTheDocument();

    // Click the #project tag badge on the note card (has aria-label)
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /filter by tag: project/i }),
    );

    // After filtering: only Meeting Notes (has #project) should remain
    await waitFor(() => {
      expect(screen.getByText("Meeting Notes")).toBeInTheDocument();
    });
    expect(screen.queryByText("Shopping List")).not.toBeInTheDocument();

    // Active filter badge should be shown
    expect(screen.getByText(/filtered by:/i)).toBeInTheDocument();
  });

  it("clears tag filter when X is clicked", async () => {
    // Pre-set filter
    useFilterStore.setState({ activeTag: "project" });

    renderNotes();

    // Should show filtered results
    expect(await screen.findByText("Meeting Notes")).toBeInTheDocument();

    // Clear filter
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Clear filter"));

    await waitFor(() => {
      expect(screen.getByText("Shopping List")).toBeInTheDocument();
    });
  });

  // ── New note dialog ─────────────────────────────────────────────────

  it("opens the new note dialog when 'New Note' is clicked", async () => {
    renderNotes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /new note/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Dialog title appears alongside the button text — use a more specific query
    expect(screen.getByRole("heading", { name: /new note/i })).toBeInTheDocument();
  });

  it("creates a new note and navigates to its detail page", async () => {
    renderNotes();
    const user = userEvent.setup();

    // Open dialog
    await user.click(screen.getByRole("button", { name: /new note/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Fill form
    await user.type(
      screen.getByPlaceholderText("Title"),
      "Newly Created Note",
    );

    // Submit
    await user.click(screen.getByText("Create"));

    // Should navigate to note detail
    await waitFor(() => {
      expect(screen.getByTestId("note-detail-mock")).toBeInTheDocument();
    });
  });

  it("disables create button when title is empty", async () => {
    renderNotes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /new note/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Create button should be disabled (no title)
    expect(screen.getByText("Create").closest("button")).toBeDisabled();
  });

  it("closes the dialog when cancel is clicked", async () => {
    renderNotes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /new note/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // ── Navigation ──────────────────────────────────────────────────────

  it("navigates to note detail when a card is clicked", async () => {
    renderNotes();
    const user = userEvent.setup();

    expect(await screen.findByText("Meeting Notes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open note: meeting notes/i }));

    await waitFor(() => {
      expect(screen.getByTestId("note-detail-mock")).toBeInTheDocument();
    });
  });
});
