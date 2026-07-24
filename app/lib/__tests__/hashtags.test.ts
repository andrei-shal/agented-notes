import { expect, describe, test } from "bun:test";
import { parseHashtags } from "../hashtags";

describe("parseHashtags", () => {
  test("extracts single hashtag", () => {
    expect(parseHashtags("Hello #world")).toEqual(["world"]);
  });

  test("extracts multiple hashtags", () => {
    expect(parseHashtags("#foo #bar #baz")).toEqual(["foo", "bar", "baz"]);
  });

  test("deduplicates hashtags", () => {
    expect(parseHashtags("#tag #tag #tag")).toEqual(["tag"]);
  });

  test("lowercases hashtags", () => {
    expect(parseHashtags("#Hello #WORLD")).toEqual(["hello", "world"]);
  });

  test("supports latin letters and numbers", () => {
    expect(parseHashtags("#tag42 #hello123")).toEqual(["tag42", "hello123"]);
  });

  test("supports underscores", () => {
    expect(parseHashtags("#my_tag #another_one")).toEqual([
      "my_tag",
      "another_one",
    ]);
  });

  test("supports cyrillic letters", () => {
    expect(parseHashtags("#привет #мир")).toEqual(["привет", "мир"]);
  });

  test("does not include the hash prefix in results", () => {
    expect(parseHashtags("#alone")).toEqual(["alone"]);
  });

  test("ignores hashtags with special characters", () => {
    // The regex stops at non-word characters
    expect(parseHashtags("#tag! #tag? #tag.")).toEqual(["tag"]);
  });

  test("returns empty array for empty string", () => {
    expect(parseHashtags("")).toEqual([]);
  });

  test("returns empty array for string without hashtags", () => {
    expect(parseHashtags("Hello world plain text")).toEqual([]);
  });

  test("handles mixed content with hashtags in markdown", () => {
    const md = `# Heading
    
This is a **note** with #features and #bugfix tags.

## Subheading

- #urgent task
- regular text`;
    expect(parseHashtags(md)).toEqual(["features", "bugfix", "urgent"]);
  });

  test("does not treat markdown headings as hashtags", () => {
    // Markdown headings start with "# " (hash followed by space)
    expect(parseHashtags("# Heading\n## Subheading")).toEqual([]);
  });

  test("handles hashtags adjacent to punctuation", () => {
    expect(parseHashtags("check #note, and #update!")).toEqual([
      "note",
      "update",
    ]);
  });
});
