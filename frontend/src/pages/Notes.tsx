import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { useFilterStore } from "@/store/filterStore";
import { NoteCard, type NoteCardNote } from "@/components/NoteCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface NoteListResult {
  notes: NoteCardNote[];
  total: number;
}

export default function Notes() {
  const navigate = useNavigate();
  const activeTag = useFilterStore((s) => s.activeTag);
  const setActiveTag = useFilterStore((s) => s.setActiveTag);
  const clearFilter = useFilterStore((s) => s.clearFilter);

  const [notes, setNotes] = useState<NoteCardNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // New note dialog
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch notes
  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTag) params.set("tag", activeTag);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const qs = params.toString();
      const url = qs ? `/notes?${qs}` : "/notes";
      const result = await api.get<NoteListResult>(url);
      setNotes(result.notes);
    } catch (err) {
      console.error("Failed to fetch notes", err);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [activeTag, debouncedSearch]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Create new note
  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const note = await api.post<NoteCardNote>("/notes", {
        title: newTitle.trim(),
        content: newContent,
      });
      setShowNewDialog(false);
      setNewTitle("");
      setNewContent("");
      navigate(`/notes/${note.id}`);
    } catch (err) {
      console.error("Failed to create note", err);
    } finally {
      setCreating(false);
    }
  };

  // Tag click → filter
  const handleTagClick = (tag: string) => {
    setActiveTag(tag);
  };

  // Collect unique tags from all notes for filter display
  const allTags = [...new Set(notes.flatMap((n) => n.tags))].sort();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-lg font-semibold">Notes</h1>
        <Button onClick={() => setShowNewDialog(true)} size="sm">
          <Plus className="size-4" />
          New Note
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Active tag filter chip */}
      {activeTag && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtered by:</span>
          <Badge variant="secondary" className="gap-1">
            #{activeTag}
            <button
              onClick={clearFilter}
              className="ml-0.5 inline-flex rounded-full p-0.5 hover:bg-muted-foreground/20"
              aria-label="Clear filter"
            >
              <X className="size-3" />
            </button>
          </Badge>
        </div>
      )}

      {/* Tag cloud */}
      {allTags.length > 0 && !activeTag && (
        <div className="flex flex-wrap gap-1">
          {allTags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className={cn(
                "cursor-pointer text-xs",
                "hover:bg-secondary hover:text-secondary-foreground",
              )}
              onClick={() => handleTagClick(tag)}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleTagClick(tag);
                }
              }}
            >
              #{tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Note list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="text-sm text-muted-foreground">
            {debouncedSearch || activeTag
              ? "No notes match your search"
              : "No notes yet"}
          </p>
          {!debouncedSearch && !activeTag && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewDialog(true)}
            >
              <Plus className="size-4" />
              Create your first note
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onTagClick={handleTagClick}
              onClick={() => navigate(`/notes/${note.id}`)}
            />
          ))}
        </div>
      )}

      {/* New Note Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Note</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
            <Textarea
              placeholder="Write your note in Markdown… Use #hashtags to tag this note."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="min-h-32"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newTitle.trim() || creating}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
