import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import CalendarPage from "../Calendar";
import { useAuthStore } from "../../store/authStore";

// ═══════════════════════════════════════════════════════════════════════════
// Mock FullCalendar — jsdom has no layout so the real component would crash.
// Instead we render a thin surrogate that wires up the callbacks.
// ═══════════════════════════════════════════════════════════════════════════

let mockDateClick: ((arg: { dateStr: string; allDay: boolean }) => void) | null = null;
let mockEventClick: ((arg: { event: Record<string, unknown> }) => void) | null = null;
let mockDatesSet: ((arg: { start: Date; end: Date }) => void) | null = null;

vi.mock("@fullcalendar/react", () => ({
  default: vi.fn((props: Record<string, unknown>) => {
    // Store callbacks so tests can invoke them
    mockDateClick = props["dateClick"] as typeof mockDateClick;
    mockEventClick = props["eventClick"] as typeof mockEventClick;
    mockDatesSet = props["datesSet"] as typeof mockDatesSet;

    // Provide a calendar-like div with events data for assertions
    const events = props["events"] as Array<Record<string, unknown>>;
    const eventList = (events ?? [])
      .map(
        (e) =>
          `<li data-testid="fc-event" data-event-id="${String(e["id"])}">${String(e["title"])}</li>`,
      )
      .join("");

    return (
      <div data-testid="fullcalendar">
        <div data-testid="fc-events-count">{events?.length ?? 0}</div>
        <ul dangerouslySetInnerHTML={{ __html: eventList }} />
      </div>
    );
  }),
}));

vi.mock("@fullcalendar/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/interaction", () => ({ default: {} }));

// ═══════════════════════════════════════════════════════════════════════════
// MSW server
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = "/api";

const sampleEvents = [
  {
    id: "evt-1",
    title: "Team Standup",
    startDate: "2025-07-28T09:00:00.000Z",
    endDate: "2025-07-28T09:30:00.000Z",
    allDay: false,
    color: "#3b82f6",
    description: "Daily sync",
    rrule: null,
    isOccurrence: false,
  },
  {
    id: "evt-2",
    title: "Recurring Weekly",
    startDate: "2025-07-21T09:00:00.000Z",
    endDate: "2025-07-21T09:30:00.000Z",
    allDay: false,
    color: "#22c55e",
    description: "Weekly",
    rrule: "FREQ=WEEKLY;BYDAY=MO",
    isOccurrence: true,
    originalStartDate: "2025-07-21T09:00:00.000Z",
  },
];

let createdEvents: Array<Record<string, unknown>> = [...sampleEvents];

const handlers = [
  http.get(`${API_BASE}/events`, ({ request }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
      return HttpResponse.json({ error: "from and to are required" }, { status: 400 });
    }
    return HttpResponse.json(createdEvents);
  }),

  http.post(`${API_BASE}/events`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const newEvent = {
      id: `evt-${Date.now()}`,
      title: String(body["title"] ?? ""),
      startDate: String(body["startDate"] ?? ""),
      endDate: (body["endDate"] as string) ?? null,
      allDay: Boolean(body["allDay"]),
      color: (body["color"] as string) ?? null,
      description: (body["description"] as string) ?? null,
      rrule: null,
      isOccurrence: false,
    };
    createdEvents.push(newEvent);
    return HttpResponse.json(newEvent, { status: 201 });
  }),

  http.put(`${API_BASE}/events/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const eventId = params["id"];
    const idx = createdEvents.findIndex((e) => e["id"] === eventId);
    if (idx === -1) {
      return HttpResponse.json({ error: "Event not found" }, { status: 404 });
    }
    createdEvents[idx] = { ...createdEvents[idx], ...body };
    return HttpResponse.json(createdEvents[idx]);
  }),

  http.delete(`${API_BASE}/events/:id`, ({ params }) => {
    const eventId = params["id"];
    const idx = createdEvents.findIndex((e) => e["id"] === eventId);
    if (idx === -1) {
      return HttpResponse.json({ error: "Event not found" }, { status: 404 });
    }
    createdEvents.splice(idx, 1);
    return HttpResponse.json({ message: "Event deleted" });
  }),
];

const server = setupServer(...handlers);

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function renderPage() {
  return render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>,
  );
}

/** Fire the datesSet callback so events are fetched. */
function loadEvents() {
  if (mockDatesSet) {
    mockDatesSet({
      start: new Date("2025-07-01"),
      end: new Date("2025-08-01"),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite
// ═══════════════════════════════════════════════════════════════════════════

describe("CalendarPage", () => {
  beforeAll(() => {
    server.listen();
    // Authenticated
    useAuthStore.getState().login("test-token", { id: 1, username: "test" });
  });

  afterEach(() => {
    server.resetHandlers();
    createdEvents = [...sampleEvents];
    mockDateClick = null;
    mockEventClick = null;
    mockDatesSet = null;
  });

  afterAll(() => {
    server.close();
  });

  // ── Rendering ─────────────────────────────────────────────────────

  it("renders the Calendar heading", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /calendar/i })).toBeInTheDocument();
  });

  it("renders FullCalendar placeholder", () => {
    renderPage();
    expect(screen.getByTestId("fullcalendar")).toBeInTheDocument();
  });

  it("fetches and displays events when dates are set", async () => {
    renderPage();
    loadEvents();

    await waitFor(() => {
      expect(screen.getByTestId("fc-events-count").textContent).toBe("2");
    });

    expect(screen.getByText("Team Standup")).toBeInTheDocument();
    expect(screen.getByText("Recurring Weekly")).toBeInTheDocument();
  });

  // ── Date click → create dialog ────────────────────────────────────

  it("opens create dialog when a date is clicked", async () => {
    renderPage();
    loadEvents();

    await waitFor(() => {
      expect(screen.getByTestId("fullcalendar")).toBeInTheDocument();
    });

    // Simulate a date click
    if (mockDateClick) {
      mockDateClick({ dateStr: "2025-08-15", allDay: true });
    }

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getByText("New Event")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Meeting, reminder, …")).toBeInTheDocument();
  });

  it("fills the start date when opened from a date click (all-day)", async () => {
    renderPage();
    loadEvents();
    await waitFor(() => expect(screen.getByTestId("fullcalendar")).toBeInTheDocument());

    if (mockDateClick) {
      mockDateClick({ dateStr: "2025-08-15", allDay: true });
    }

    await waitFor(() => {
      const startInput = screen.getByLabelText("Start") as HTMLInputElement;
      expect(startInput.value).toBe("2025-08-15T00:00");
    });
  });

  // ── Event click → edit dialog ─────────────────────────────────────

  it("opens edit dialog when an event is clicked", async () => {
    renderPage();
    loadEvents();

    await waitFor(() => {
      expect(screen.getByText("Team Standup")).toBeInTheDocument();
    });

    // Simulate event click
    if (mockEventClick) {
      mockEventClick({
        event: {
          id: "evt-1",
          title: "Team Standup",
          start: new Date("2025-07-28T09:00:00.000Z"),
          end: new Date("2025-07-28T09:30:00.000Z"),
          allDay: false,
          extendedProps: {
            description: "Daily sync",
            color: "#3b82f6",
            isOccurrence: false,
          },
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getByText("Edit Event")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Team Standup")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Daily sync")).toBeInTheDocument();
  });

  it("shows delete button for non-occurrence events in edit mode", async () => {
    renderPage();
    loadEvents();
    await waitFor(() => expect(screen.getByText("Team Standup")).toBeInTheDocument());

    if (mockEventClick) {
      mockEventClick({
        event: {
          id: "evt-1",
          title: "Team Standup",
          start: new Date("2025-07-28T09:00:00.000Z"),
          end: new Date("2025-07-28T09:30:00.000Z"),
          allDay: false,
          extendedProps: {
            description: "Daily sync",
            color: "#3b82f6",
            isOccurrence: false,
          },
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  // ── Create event ──────────────────────────────────────────────────

  it("creates a new event via the dialog", async () => {
    const user = userEvent.setup();
    renderPage();
    loadEvents();

    await waitFor(() => expect(screen.getByTestId("fullcalendar")).toBeInTheDocument());

    // Open create dialog
    if (mockDateClick) {
      mockDateClick({ dateStr: "2025-08-20T14:00:00", allDay: false });
    }

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Fill form
    await user.clear(screen.getByLabelText(/title/i));
    await user.type(screen.getByLabelText(/title/i), "New Test Event");
    await user.type(screen.getByLabelText(/description/i), "Test description");

    // Submit
    await user.click(screen.getByRole("button", { name: /create event/i }));

    // Dialog should close and new event should appear
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("New Test Event")).toBeInTheDocument();
  });

  // ── Edit event ────────────────────────────────────────────────────

  it("edits an existing event", async () => {
    const user = userEvent.setup();
    renderPage();
    loadEvents();

    await waitFor(() => expect(screen.getByText("Team Standup")).toBeInTheDocument());

    if (mockEventClick) {
      mockEventClick({
        event: {
          id: "evt-1",
          title: "Team Standup",
          start: new Date("2025-07-28T09:00:00.000Z"),
          end: new Date("2025-07-28T09:30:00.000Z"),
          allDay: false,
          extendedProps: {
            description: "Daily sync",
            color: "#3b82f6",
            isOccurrence: false,
          },
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Edit title
    const titleInput = screen.getByDisplayValue("Team Standup");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated Standup");

    // Save
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Updated Standup")).toBeInTheDocument();
    expect(screen.queryByText("Team Standup")).not.toBeInTheDocument();
  });

  // ── Delete event ──────────────────────────────────────────────────

  it("deletes an event", async () => {
    const user = userEvent.setup();
    renderPage();
    loadEvents();

    await waitFor(() => expect(screen.getByText("Team Standup")).toBeInTheDocument());

    if (mockEventClick) {
      mockEventClick({
        event: {
          id: "evt-1",
          title: "Team Standup",
          start: new Date("2025-07-28T09:00:00.000Z"),
          end: new Date("2025-07-28T09:30:00.000Z"),
          allDay: false,
          extendedProps: {
            description: "Daily sync",
            color: "#3b82f6",
            isOccurrence: false,
          },
        },
      });
    }

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Event should be removed
    const eventItems = screen.getAllByTestId("fc-event");
    expect(eventItems).toHaveLength(1); // only Recurring Weekly remains
  });

  // ── Empty state ───────────────────────────────────────────────────

  it("shows no events when API returns empty list", async () => {
    createdEvents = [];
    renderPage();
    loadEvents();

    await waitFor(() => {
      expect(screen.getByTestId("fc-events-count").textContent).toBe("0");
    });
  });

  it("closes dialog on cancel via close button", async () => {
    const user = userEvent.setup();
    renderPage();
    loadEvents();
    await waitFor(() => expect(screen.getByTestId("fullcalendar")).toBeInTheDocument());

    if (mockDateClick) {
      mockDateClick({ dateStr: "2025-08-15", allDay: true });
    }

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Find and click the close button
    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
