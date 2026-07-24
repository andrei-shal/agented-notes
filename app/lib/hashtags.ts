/**
 * Hashtag parsing from Markdown content.
 *
 * Extracts #word patterns supporting:
 * - Latin and Cyrillic letters
 * - Numbers
 * - Underscores
 * - No special characters or punctuation
 */

// Unicode-aware: \p{L} = any letter (Latin, Cyrillic, etc.), \p{N} = any number
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

/**
 * Parse hashtags from a Markdown string.
 *
 * - Returns lowercase, deduplicated tag names (without the `#` prefix).
 * - Returns an empty array for falsy or empty input.
 */
export function parseHashtags(content: string): string[] {
  if (!content) return [];

  const matches = content.matchAll(HASHTAG_RE);
  const tags = new Set<string>();
  for (const match of matches) {
    tags.add(match[1]!.toLowerCase());
  }

  return Array.from(tags);
}
