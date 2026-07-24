import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteCard, type NoteCardNote } from "../NoteCard";

const sampleNote: NoteCardNote = {
  id: "note-1",
  title: "Test Note",
  content: "This is a test note with some #hashtag content",
  createdAt: "2025-07-24T10:00:00.000Z",
  tags: ["hashtag", "test"],
};

function renderNoteCard(note: NoteCardNote = sampleNote) {
  const onTagClick = vi.fn();
  const onClick = vi.fn();
  const result = render(
    <NoteCard note={note} onTagClick={onTagClick} onClick={onClick} />,
  );
  return { onTagClick, onClick, ...result };
}

describe("NoteCard", () => {
  it("renders the note title", () => {
    renderNoteCard();
    expect(screen.getByText("Test Note")).toBeInTheDocument();
  });

  it("renders tags with # prefix", () => {
    renderNoteCard();
    expect(screen.getByText("#hashtag")).toBeInTheDocument();
    expect(screen.getByText("#test")).toBeInTheDocument();
  });

  it("renders date in readable format", () => {
    renderNoteCard();
    // Jul 24, 2025 (locale-dependent, but should include Jul)
    expect(screen.getByText(/jul/i)).toBeInTheDocument();
  });

  it("renders content preview (stripped of markdown)", () => {
    renderNoteCard();
    expect(
      screen.getByText(/this is a test note with some hashtag content/i),
    ).toBeInTheDocument();
  });

  it("calls onClick when card is clicked", async () => {
    const { onClick } = renderNoteCard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /open note/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onTagClick with the tag name when a tag is clicked", async () => {
    const { onTagClick } = renderNoteCard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /filter by tag: hashtag/i }));
    expect(onTagClick).toHaveBeenCalledWith("hashtag");
  });

  it("renders untitled note when title is empty", () => {
    renderNoteCard({ ...sampleNote, title: "" });
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("hides tags section when there are no tags", () => {
    renderNoteCard({ ...sampleNote, tags: [] });
    expect(screen.queryByText("#hashtag")).not.toBeInTheDocument();
  });

  it("shows no content preview for empty content", () => {
    renderNoteCard({ ...sampleNote, content: "" });
    // Only tags and title should be visible
    expect(screen.getByText("Test Note")).toBeInTheDocument();
    // Content preview should not appear (no preview paragraph)
    const previewText = screen.queryByText(/This is a/i);
    expect(previewText).not.toBeInTheDocument();
  });
});
