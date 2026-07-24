import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  ArrowLeft,
  Calendar,
  GripVertical,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  kanbanApi,
  type KanbanBoardListItem,
  type KanbanBoardWithColumns,
  type KanbanColumnWithTasks,
  type KanbanTaskItem,
} from "@/lib/api";

// ── Helpers ─────────────────────────────────────────────────────────────────

const COLORS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

function columnColor(idx: number, color: string | null): string {
  if (color) return color;
  return COLORS[idx % COLORS.length]!;
}

function dueDateState(dateStr: string | null): "overdue" | "today" | "upcoming" | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  const diff = due.getTime() - today.getTime();
  const dayMs = 86_400_000;
  if (diff < 0) return "overdue";
  if (diff < dayMs) return "today";
  return "upcoming";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── SortableTaskCard ────────────────────────────────────────────────────────

function SortableTaskCard({
  task,
  onEdit,
}: {
  task: KanbanTaskItem;
  onEdit: (t: KanbanTaskItem) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dds = dueDateState(task.dueDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn("group/task", isDragging && "opacity-30")}
    >
      <Card
        size="sm"
        className={cn(
          "cursor-pointer transition-shadow hover:shadow-sm",
          isDragging && "shadow-none",
        )}
        onClick={() => onEdit(task)}
      >
        <CardContent className="flex flex-col gap-1.5">
          {/* Header with grip and title */}
          <div className="flex items-start gap-1.5">
            <button
              {...listeners}
              className="mt-0.5 shrink-0 cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground"
              aria-label="Drag task"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="size-3.5" />
            </button>
            <span className="min-w-0 flex-1 text-xs font-medium leading-snug">
              {task.title}
            </span>
          </div>

          {/* Description preview */}
          {task.description && (
            <p className="line-clamp-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
              {task.description}
            </p>
          )}

          {/* Footer: tags + due date */}
          <div className="flex flex-wrap items-center gap-1 px-1">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-muted px-1.5 py-[1px] text-[10px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {task.dueDate && (
              <Badge
                variant={
                  dds === "overdue"
                    ? "destructive"
                    : dds === "today"
                      ? "outline"
                      : "secondary"
                }
                className={cn(
                  "ml-auto gap-1 text-[10px] font-normal",
                  dds === "overdue" && "border-destructive/30",
                  dds === "today" && "border-amber-400 text-amber-700 dark:text-amber-400",
                )}
              >
                <Calendar className="size-3" />
                {formatDate(task.dueDate)}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── DragOverlay card ────────────────────────────────────────────────────────

function DragOverlayCard({ task }: { task: KanbanTaskItem }) {
  return (
    <Card
      size="sm"
      className="rotate-3 shadow-lg ring-1 ring-foreground/10"
    >
      <CardContent className="flex flex-col gap-1.5">
        <span className="text-xs font-medium leading-snug">{task.title}</span>
        {task.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {task.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-1.5 py-[1px] text-[10px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Column component ────────────────────────────────────────────────────────

function Column({
  column,
  idx,
  onEditTask,
  onAddTask,
}: {
  column: KanbanColumnWithTasks;
  idx: number;
  onEditTask: (t: KanbanTaskItem) => void;
  onAddTask: () => void;
}) {
  const color = columnColor(idx, column.color);

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40">
      {/* Column header */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-xl px-3 py-2.5 text-xs font-semibold text-white",
          color,
        )}
      >
        <span className="truncate">{column.name}</span>
        <span className="ml-auto rounded-full bg-white/20 px-1.5 py-[1px] text-[10px] tabular-nums">
          {column.tasks.length}
        </span>
      </div>

      {/* Task list */}
      <div className="flex flex-col gap-2 p-2">
        <SortableContext
          items={column.tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {column.tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onEdit={onEditTask} />
          ))}
        </SortableContext>

        {/* Add task button */}
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 justify-start gap-1.5 text-muted-foreground"
          onClick={onAddTask}
        >
          <Plus className="size-3.5" />
          Add task
        </Button>
      </div>
    </div>
  );
}

// ── Create Board Dialog ─────────────────────────────────────────────────────

function CreateBoardDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await kanbanApi.createBoard({ name: name.trim(), description: description.trim() || null });
      onOpenChange(false);
      setName("");
      setDescription("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create board");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
          <DialogDescription>Create a kanban board to organize your tasks.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            placeholder="Board name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autoFocus
          />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleSubmit} disabled={!name.trim() || saving}>
            {saving ? "Creating…" : "Create board"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task Edit Dialog ────────────────────────────────────────────────────────

function TaskEditDialog({
  task,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: {
  task: KanbanTaskItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdated: (t: KanbanTaskItem) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setDueDate(task.dueDate ?? "");
      setTagsInput(task.tags.join(", "));
      setError(null);
    }
  }, [task]);

  const handleSave = async () => {
    if (!task || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await kanbanApi.updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        dueDate: dueDate || null,
        tags: parsed,
      });
      onUpdated(updated);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update task");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    setDeleting(true);
    setError(null);
    try {
      await kanbanApi.deleteTask(task.id);
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete task");
    } finally {
      setDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Due date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              Tags (comma-separated)
            </label>
            <Input
              placeholder="e.g. bug, feature, urgent"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter showCloseButton>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
            className="mr-auto"
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
          <Button onClick={handleSave} disabled={!title.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Task Dialog ─────────────────────────────────────────────────────────

function AddTaskDialog({
  columnId,
  boardId,
  open,
  onOpenChange,
  onCreated,
}: {
  columnId: string;
  boardId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (task: KanbanTaskItem) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const task = await kanbanApi.createTask(boardId, columnId, {
        title: title.trim(),
        description: description.trim() || null,
        dueDate: dueDate || null,
        tags: parsed,
      });
      onCreated(task);
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setDueDate("");
      setTagsInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autoFocus
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Due date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              Tags (comma-separated)
            </label>
            <Input
              placeholder="e.g. bug, feature, urgent"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={handleSubmit} disabled={!title.trim() || saving}>
            {saving ? "Creating…" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Column Dialog ───────────────────────────────────────────────────────

function AddColumnDialog({
  boardId,
  open,
  onOpenChange,
  onCreated,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await kanbanApi.createColumn(boardId, { name: name.trim() });
      onOpenChange(false);
      setName("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create column");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add column</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Column name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter showCloseButton>
          <Button onClick={handleSubmit} disabled={!name.trim() || saving}>
            {saving ? "Adding…" : "Add column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Kanban page (default export) ────────────────────────────────────────────

export default function Kanban() {
  const [view, setView] = useState<"list" | "board">("list");
  const [boards, setBoards] = useState<KanbanBoardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBoard, setCurrentBoard] = useState<KanbanBoardWithColumns | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  // Dialogs
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [editingTask, setEditingTask] = useState<KanbanTaskItem | null>(null);
  const [showAddTask, setShowAddTask] = useState<string | null>(null); // columnId
  const [showAddColumn, setShowAddColumn] = useState(false);

  // Drag state
  const [activeTask, setActiveTask] = useState<KanbanTaskItem | null>(null);
  const prevBoardRef = useRef<KanbanBoardWithColumns | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // ── Fetch boards ──────────────────────────────────────────────────────

  const fetchBoards = useCallback(async () => {
    setLoading(true);
    try {
      const data = await kanbanApi.listBoards();
      setBoards(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  // ── Fetch board ───────────────────────────────────────────────────────

  const fetchBoard = useCallback(async (id: string) => {
    setBoardLoading(true);
    try {
      const data = await kanbanApi.getBoard(id);
      setCurrentBoard(data);
      prevBoardRef.current = structuredClone(data);
    } catch {
      setView("list");
    } finally {
      setBoardLoading(false);
    }
  }, []);

  // ── Navigate to board ─────────────────────────────────────────────────

  const openBoard = useCallback(
    (id: string) => {
      setView("board");
      fetchBoard(id);
    },
    [fetchBoard],
  );

  const goBack = useCallback(() => {
    setView("list");
    setCurrentBoard(null);
    setActiveTask(null);
    fetchBoards();
  }, [fetchBoards]);

  // ── Helpers for drag ──────────────────────────────────────────────────

  const columns = currentBoard?.columns ?? [];

  function findContainer(id: string): string | undefined {
    if (columns.some((c) => c.id === id)) return id;
    return columns.find((c) => c.tasks.some((t) => t.id === id))?.id;
  }

  function findTask(id: string): KanbanTaskItem | undefined {
    for (const col of columns) {
      const t = col.tasks.find((t) => t.id === id);
      if (t) return t;
    }
    return undefined;
  }

  // ── Drag handlers ─────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const task = findTask(String(event.active.id));
    if (task) {
      setActiveTask(task);
      // Snapshot current board for rollback
      if (currentBoard) {
        prevBoardRef.current = structuredClone(currentBoard);
      }
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer) return;
    if (activeContainer === overContainer) return;

    setCurrentBoard((prev) => {
      if (!prev) return prev;
      const newColumns = prev.columns.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) => ({ ...t })),
      }));

      const sourceCol = newColumns.find((c) => c.id === activeContainer)!;
      const destCol = newColumns.find((c) => c.id === overContainer)!;

      const taskIdx = sourceCol.tasks.findIndex((t) => t.id === activeId);
      if (taskIdx === -1) return prev;
      const moved = sourceCol.tasks.splice(taskIdx, 1)[0];
      if (!moved) return prev;
      moved.columnId = destCol.id;

      // Insert at position of the over item (or append if over is the column)
      const overIdx = destCol.tasks.findIndex((t) => t.id === overId);
      if (overIdx >= 0) {
        destCol.tasks.splice(overIdx, 0, moved);
      } else {
        destCol.tasks.push(moved);
      }

      return { ...prev, columns: newColumns };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const taskId = String(active.id);
    const savedBoard = prevBoardRef.current;

    setActiveTask(null);

    if (!over || active.id === over.id) return;

    const activeContainer = findContainer(taskId);
    if (!activeContainer) return;

    const overId = String(over.id);
    const overContainer = findContainer(overId);
    if (!overContainer) return;

    const targetCol = columns.find((c) => c.id === overContainer);
    if (!targetCol) return;

    // Determine target position
    const overIndex = targetCol.tasks.findIndex((t) => t.id === overId);
    const targetPosition = overIndex >= 0 ? overIndex : targetCol.tasks.length - 1;

    // Optimistic state is already set from onDragOver. Call API to persist.
    kanbanApi
      .moveTask(taskId, {
        targetColumnId: overContainer,
        targetPosition,
      })
      .catch(() => {
        // Rollback on failure
        if (savedBoard) {
          setCurrentBoard(savedBoard);
        }
      });
  }

  // ── Task CRUD callbacks ───────────────────────────────────────────────

  const handleTaskUpdated = useCallback((updated: KanbanTaskItem) => {
    setCurrentBoard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) => ({
          ...col,
          tasks: col.tasks.map((t) => (t.id === updated.id ? { ...updated } : t)),
        })),
      };
    });
  }, []);

  const handleTaskDeleted = useCallback(() => {
    if (currentBoard) fetchBoard(currentBoard.id);
  }, [currentBoard, fetchBoard]);

  const handleTaskCreated = useCallback(
    (task: KanbanTaskItem) => {
      setCurrentBoard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          columns: prev.columns.map((col) =>
            col.id === task.columnId
              ? { ...col, tasks: [...col.tasks, task] }
              : col,
          ),
        };
      });
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────

  if (view === "list") {
    return (
      <div className="flex h-full flex-col gap-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="size-5 text-primary" />
            <h1 className="font-heading text-lg font-semibold">Kanban boards</h1>
          </div>
          <Button onClick={() => setShowCreateBoard(true)}>
            <Plus className="size-4" />
            New board
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading boards…</p>
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <LayoutDashboard className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No boards yet</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateBoard(true)}
            >
              <Plus className="size-4" />
              Create your first board
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <Card
                key={board.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => openBoard(board.id)}
              >
                <CardContent className="flex flex-col gap-1.5 p-4">
                  <span className="font-heading text-sm font-semibold">
                    {board.name}
                  </span>
                  {board.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {board.description}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {board.columns.reduce((s, c) => s + c.taskCount, 0)} tasks
                    </span>
                    <span>·</span>
                    <span>
                      {board.columns.length}{" "}
                      {board.columns.length === 1 ? "column" : "columns"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <CreateBoardDialog
          open={showCreateBoard}
          onOpenChange={setShowCreateBoard}
          onCreated={fetchBoards}
        />
      </div>
    );
  }

  // ── Board detail view ─────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
        <Button variant="ghost" size="icon-sm" onClick={goBack} aria-label="Back to boards">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h2 className="font-heading text-base font-semibold leading-tight">
            {currentBoard?.name ?? "Board"}
          </h2>
          {currentBoard?.description && (
            <p className="text-xs text-muted-foreground">
              {currentBoard.description}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowAddColumn(true)}>
          <Plus className="size-4" />
          Column
        </Button>
      </div>

      {/* Board area */}
      {boardLoading || !currentBoard ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading board…</p>
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4 md:p-6">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {columns.map((col, idx) => (
              <Column
                key={col.id}
                column={col}
                idx={idx}
                onEditTask={setEditingTask}
                onAddTask={() => setShowAddTask(col.id)}
              />
            ))}
            <DragOverlay dropAnimation={null}>
              {activeTask ? <DragOverlayCard task={activeTask} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* Dialogs */}
      <TaskEditDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(v) => {
          if (!v) setEditingTask(null);
        }}
        onUpdated={handleTaskUpdated}
        onDeleted={handleTaskDeleted}
      />

      {showAddTask && currentBoard && (
        <AddTaskDialog
          columnId={showAddTask}
          boardId={currentBoard.id}
          open={!!showAddTask}
          onOpenChange={(v) => {
            if (!v) setShowAddTask(null);
          }}
          onCreated={handleTaskCreated}
        />
      )}

      {showAddColumn && currentBoard && (
        <AddColumnDialog
          boardId={currentBoard.id}
          open={showAddColumn}
          onOpenChange={setShowAddColumn}
          onCreated={() => fetchBoard(currentBoard.id)}
        />
      )}
    </div>
  );
}
