import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { ArrowLeft, Edit3, Trash2, Save, X, SendHorizonal } from "lucide-react";
import { api } from "@/lib/api";
import { useFilterStore } from "@/store/filterStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface NoteComment {
  id: string;
  content: string;
  status: string;
  createdAt: string;
}

interface NoteWithComments {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  comments: NoteComment[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Renders inline content as Markdown (used within table cells etc.).
 */
function InlineMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <span>{children}</span>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setActiveTag = useFilterStore((s) => s.setActiveTag);

  const [note, setNote] = useState<NoteWithComments | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Comments
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  // ── Fetch note ──────────────────────────────────────────────────────────

  const fetchNote = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.get<NoteWithComments>(`/notes/${id}`);
      setNote(data);
      setComments(data.comments ?? []);
      setEditTitle(data.title);
      setEditContent(data.content);
    } catch (err) {
      console.error("Failed to fetch note", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchNote();
  }, [fetchNote]);

  // ── Update note ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!id || !editTitle.trim()) return;
    setSaving(true);
    try {
      const updated = await api.put<NoteWithComments>(`/notes/${id}`, {
        title: editTitle.trim(),
        content: editContent,
      });
      setNote(updated);
      setComments(updated.comments ?? []);
      setEditing(false);
    } catch (err) {
      console.error("Failed to update note", err);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete note ─────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm("Delete this note? This action cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.delete(`/notes/${id}`);
      navigate("/notes", { replace: true });
    } catch (err) {
      console.error("Failed to delete note", err);
      setDeleting(false);
    }
  };

  // ── Add comment ─────────────────────────────────────────────────────────

  const handleAddComment = async () => {
    if (!id || !commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await api.post<{ data: NoteComment }>(
        `/notes/${id}/comments`,
        { content: commentText.trim() },
      );
      setComments((prev) => [...prev, res.data]);
      setCommentText("");
    } catch (err) {
      console.error("Failed to add comment", err);
    } finally {
      setSubmittingComment(false);
    }
  };

  // ── Hashtag click handler ───────────────────────────────────────────────

  const handleHashtagClick = (tag: string) => {
    setActiveTag(tag);
    navigate("/notes");
  };

  // ── Render: Loading ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // ── Render: Not found ───────────────────────────────────────────────────

  if (!note) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-muted-foreground">Note not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/notes")}>
          Back to Notes
        </Button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/notes")}
          className="gap-1"
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>

        <div className="flex items-center gap-1">
          {!editing && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditing(true)}
                aria-label="Edit note"
              >
                <Edit3 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                disabled={deleting}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete note"
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Editor / View ───────────────────────────────────────────────── */}
      {editing ? (
        <div className="flex flex-col gap-3">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            className="font-heading text-lg font-semibold"
          />
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Write your note in Markdown…"
            className="min-h-48"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setEditTitle(note.title);
                setEditContent(note.content);
              }}
            >
              <X className="size-4" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!editTitle.trim() || saving}
            >
              <Save className="size-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Title ──────────────────────────────────────────────────── */}
          <h1 className="font-heading text-xl font-semibold leading-snug">
            {note.title || "Untitled"}
          </h1>

          {/* ── Meta: tags + date ──────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            {note.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className={cn(
                  "cursor-pointer text-xs",
                  "hover:bg-secondary/80",
                )}
                onClick={() => handleHashtagClick(tag)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleHashtagClick(tag);
                  }
                }}
              >
                #{tag}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">
              Updated {formatDate(note.updatedAt)}
            </span>
          </div>

          {/* Markdown body */}
          <div className="markdown-body">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
              {note.content || "*No content*"}
            </ReactMarkdown>
          </div>
        </>
      )}

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <hr className="my-2 border-border" />

      {/* ── Comments section ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-semibold text-muted-foreground">
          Comments ({comments.length})
        </h2>

        {/* Comment list */}
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="flex flex-col gap-1 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(comment.createdAt)}
                  </span>
                  {comment.status === "pending" && (
                    <Badge variant="outline" className="text-[10px] uppercase">
                      Pending
                    </Badge>
                  )}
                </div>
                <div className="text-sm">
                  <InlineMarkdown content={comment.content} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add comment form */}
        <div className="flex gap-2">
          <Textarea
            placeholder="Write a comment…"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            className="min-h-9 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAddComment();
              }
            }}
          />
          <Button
            size="icon"
            onClick={handleAddComment}
            disabled={!commentText.trim() || submittingComment}
            className="shrink-0 self-end"
            aria-label="Submit comment"
          >
            <SendHorizonal className="size-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
