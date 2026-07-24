import { useCallback, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import "./calendar.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarEvent {
  id: string;
  title: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
  allDay?: boolean;
  rrule?: string | null;
  color?: string | null;
  createdAt?: string;
  isOccurrence?: boolean;
  originalStartDate?: string;
}

interface FormState {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  color: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_COLORS = [
  { label: "Blue", value: "#3b82f6" },
  { label: "Green", value: "#22c55e" },
  { label: "Red", value: "#ef4444" },
  { label: "Purple", value: "#a855f7" },
  { label: "Orange", value: "#f97316" },
  { label: "Pink", value: "#ec4899" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Cyan", value: "#06b6d4" },
] as const;

const INITIAL_FORM: FormState = {
  title: "",
  description: "",
  startDate: "",
  endDate: "",
  allDay: false,
  color: EVENT_COLORS[0].value,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an ISO-8601 string to the value expected by <input type="datetime-local">. */
function toDatetimeLocal(iso: string): string {
  if (!iso) return "";
  // Date-only (YYYY-MM-DD) — no timezone ambiguity
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso + "T00:00";
  // Strip timezone suffix so the input shows local time
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert <input type="datetime-local"> value back to ISO-8601. */
function fromDatetimeLocal(val: string): string {
  if (!val) return "";
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? val : d.toISOString();
}

/** Build an event map for FullCalendar from API CalendarEvent[]. */
function toCalendarEventInput(events: CalendarEvent[]) {
  return events.map((ev) => ({
    id: ev.id,
    title: ev.title,
    start: ev.startDate,
    end: ev.endDate ?? undefined,
    allDay: ev.allDay ?? false,
    backgroundColor: ev.color ?? EVENT_COLORS[0].value,
    borderColor: ev.color ?? EVENT_COLORS[0].value,
    textColor: "#fff",
    classNames: ev.isOccurrence ? ["fc-event-occurrence"] : [],
    extendedProps: {
      description: ev.description,
      rrule: ev.rrule,
      color: ev.color,
      isOccurrence: ev.isOccurrence,
      originalStartDate: ev.originalStartDate,
    },
  }));
}

/** Build a request body for create / update. */
function toApiBody(form: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    startDate: fromDatetimeLocal(form.startDate),
    endDate: form.endDate ? fromDatetimeLocal(form.endDate) : undefined,
    allDay: form.allDay,
    color: form.color,
  };
  return body;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// FullCalendar arg types (avoid direct dep on @fullcalendar/core)
interface DateClickArg {
  dateStr: string;
  allDay: boolean;
}
interface CalendarDatesSetArg {
  start: Date;
  end: Date;
  startStr: string;
  endStr: string;
  view: { type: string };
}
interface CalendarEventClickArg {
  event: {
    id: string;
    title: string;
    start: Date | null;
    end: Date | null;
    allDay: boolean;
    extendedProps: Record<string, unknown>;
    toPlainObject: () => Record<string, unknown>;
  };
}

export default function CalendarPage() {
  const calendarRef = useRef<FullCalendar>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────

  const fetchEvents = useCallback(async (start: string, end: string) => {
    try {
      const from = encodeURIComponent(start);
      const to = encodeURIComponent(end);
      const data = await api.get<CalendarEvent[]>(`/events?from=${from}&to=${to}`);
      setEvents(data);
    } catch (err) {
      console.error("Failed to fetch events", err);
    }
  }, []);

  const handleDatesSet = useCallback(
    (arg: CalendarDatesSetArg) => {
      fetchEvents(arg.start.toISOString(), arg.end.toISOString());
    },
    [fetchEvents],
  );

  // ── Dialog helpers ──────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM);
    setError(null);
    setEditingEvent(null);
  }, []);

  const openCreateDialog = useCallback(
    (startDate: string, allDay: boolean) => {
      resetForm();
      setDialogMode("create");
      setForm((prev) => ({
        ...prev,
        startDate,
        endDate: startDate,
        allDay,
      }));
      setDialogOpen(true);
    },
    [resetForm],
  );

  const openEditDialog = useCallback(
    (eventData: CalendarEvent) => {
      setEditingEvent(eventData);
      setForm({
        title: eventData.title,
        description: eventData.description ?? "",
        startDate: eventData.startDate,
        endDate: eventData.endDate ?? "",
        allDay: eventData.allDay ?? false,
        color: eventData.color ?? EVENT_COLORS[0].value,
      });
      setDialogMode("edit");
      setDialogOpen(true);
    },
    [],
  );

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    // Wait for animation to finish before clearing form
    setTimeout(resetForm, 150);
  }, [resetForm]);

  // ── FullCalendar callbacks ─────────────────────────────────────────

  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      openCreateDialog(arg.dateStr, arg.allDay);
    },
    [openCreateDialog],
  );

  const handleEventClick = useCallback(
    (arg: CalendarEventClickArg) => {
      const ev = arg.event;
      const props = ev.extendedProps;
      openEditDialog({
        id: ev.id,
        title: ev.title,
        startDate: ev.start?.toISOString() ?? "",
        endDate: ev.end?.toISOString() ?? null,
        allDay: ev.allDay,
        description: (props["description"] as string) ?? null,
        rrule: (props["rrule"] as string) ?? null,
        color: (props["color"] as string) ?? null,
        isOccurrence: (props["isOccurrence"] as boolean) ?? false,
        originalStartDate: (props["originalStartDate"] as string) ?? undefined,
      });
    },
    [openEditDialog],
  );

  // ── CRUD actions ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body = toApiBody(form);

      if (dialogMode === "create") {
        const created = await api.post<CalendarEvent>("/events", body);
        setEvents((prev) => [...prev, created]);
      } else if (editingEvent && !editingEvent.isOccurrence) {
        const updated = await api.put<CalendarEvent>(
          `/events/${editingEvent.id}`,
          body,
        );
        setEvents((prev) =>
          prev.map((e) => (e.id === updated.id ? updated : e)),
        );
      }

      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save event");
    } finally {
      setSaving(false);
    }
  }, [form, dialogMode, editingEvent, closeDialog]);

  const handleDelete = useCallback(async () => {
    if (!editingEvent || editingEvent.isOccurrence) return;

    setSaving(true);
    try {
      await api.delete(`/events/${editingEvent.id}`);
      setEvents((prev) => prev.filter((e) => e.id !== editingEvent.id));
      closeDialog();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete event",
      );
    } finally {
      setSaving(false);
    }
  }, [editingEvent, closeDialog]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold">Calendar</h1>
      </div>

      <div className="calendar-wrapper flex-1 min-h-0">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,dayGridWeek,dayGridDay",
          }}
          events={toCalendarEventInput(events)}
          datesSet={handleDatesSet}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          height="100%"
          dayMaxEvents={3}
          moreLinkText={(num: number) => `+${num} more`}
          eventTimeFormat={{
            hour: "2-digit",
            minute: "2-digit",
            meridiem: "short",
          }}
          buttonText={{
            today: "Today",
            month: "Month",
            week: "Week",
            day: "Day",
          }}
          noEventsText="No events"
          nowIndicator={true}
        />
      </div>

      {/* ── Create / Edit dialog ─────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md" aria-label={dialogMode === "create" ? "New Event" : "Edit Event"}>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create" ? "New Event" : "Edit Event"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "Add a new event to your calendar."
                : editingEvent?.isOccurrence
                  ? "This is a recurring event occurrence. Edit the original event to make changes."
                  : "Update or delete this event."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            {/* Title */}
            <div className="grid gap-1.5">
              <label htmlFor="event-title" className="text-xs font-medium text-muted-foreground">
                Title <span className="text-destructive">*</span>
              </label>
              <Input
                id="event-title"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Meeting, reminder, …"
              />
            </div>

            {/* Description */}
            <div className="grid gap-1.5">
              <label htmlFor="event-description" className="text-xs font-medium text-muted-foreground">
                Description
              </label>
              <Textarea
                id="event-description"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional details…"
                rows={3}
              />
            </div>

            {/* Start / End — stacked for readability */}
            <div className="grid grid-cols-1 gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="event-start" className="text-xs font-medium text-muted-foreground">
                  Start
                </label>
                <Input
                  id="event-start"
                  type="datetime-local"
                  value={toDatetimeLocal(form.startDate)}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, startDate: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="event-end" className="text-xs font-medium text-muted-foreground">
                  End
                </label>
                <Input
                  id="event-end"
                  type="datetime-local"
                  value={toDatetimeLocal(form.endDate)}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, endDate: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* All day */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => setForm((p) => ({ ...p, allDay: e.target.checked }))}
                className="size-4 rounded border-border accent-primary"
              />
              All day
            </label>

            {/* Color picker */}
            <div className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">Color</span>
              <div className="flex flex-wrap gap-2">
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`size-7 rounded-full border-2 transition-all ${
                      form.color === c.value
                        ? "border-foreground scale-110 ring-2 ring-foreground/20"
                        : "border-transparent hover:scale-110"
                    }`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setForm((p) => ({ ...p, color: c.value }))}
                    aria-label={c.label}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            {dialogMode === "edit" && !editingEvent?.isOccurrence && (
              <Button variant="destructive" onClick={handleDelete} disabled={saving}>
                {saving ? "Deleting…" : "Delete"}
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving}>
              {saving
                ? "Saving…"
                : dialogMode === "create"
                  ? "Create event"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
