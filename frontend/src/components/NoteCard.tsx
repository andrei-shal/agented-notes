import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface NoteCardNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  tags: string[];
}

interface NoteCardProps {
  note: NoteCardNote;
  onTagClick: (tag: string) => void;
  onClick: () => void;
}

export function NoteCard({ note, onTagClick, onClick }: NoteCardProps) {
  const date = new Date(note.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Strip markdown for preview and truncate
  const preview = note.content
    .replace(/[#*`~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return (
    <Card
      size="sm"
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Open note: ${note.title}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-1">{note.title || "Untitled"}</CardTitle>
          <span className="shrink-0 text-xs text-muted-foreground">{date}</span>
        </div>
        {preview && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{preview}</p>
        )}
      </CardHeader>
      {note.tags.length > 0 && (
        <CardContent className="flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className={cn(
                "cursor-pointer text-xs",
                "hover:bg-secondary/80",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onTagClick(tag);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onTagClick(tag);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Filter by tag: ${tag}`}
            >
              #{tag}
            </Badge>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
