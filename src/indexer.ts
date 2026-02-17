const MAX_CHUNK_CHARS = 2048;  // ~512 tokens
const MIN_CHUNK_CHARS = 256;   // ~64 tokens
const OVERLAP_CHARS = 256;     // ~64 tokens

/**
 * Split text into chunks with overlap.
 * Tries to break at paragraph/sentence boundaries for cleaner chunks.
 */
export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CHUNK_CHARS) {
    return trimmed.length >= MIN_CHUNK_CHARS ? [trimmed] : [trimmed];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = start + MAX_CHUNK_CHARS;

    if (end >= trimmed.length) {
      const remaining = trimmed.slice(start).trim();
      if (remaining.length > 0) {
        // If too small, merge with previous chunk
        if (remaining.length < MIN_CHUNK_CHARS && chunks.length > 0) {
          chunks[chunks.length - 1] += "\n" + remaining;
        } else {
          chunks.push(remaining);
        }
      }
      break;
    }

    // Try to find a clean break point (paragraph > sentence > word)
    const segment = trimmed.slice(start, end);
    let breakAt = end;

    // Try paragraph break
    const lastParagraph = segment.lastIndexOf("\n\n");
    if (lastParagraph > MAX_CHUNK_CHARS * 0.3) {
      breakAt = start + lastParagraph + 2;
    } else {
      // Try sentence break
      const lastSentence = segment.lastIndexOf(". ");
      if (lastSentence > MAX_CHUNK_CHARS * 0.3) {
        breakAt = start + lastSentence + 2;
      } else {
        // Try word break
        const lastSpace = segment.lastIndexOf(" ");
        if (lastSpace > MAX_CHUNK_CHARS * 0.3) {
          breakAt = start + lastSpace + 1;
        }
      }
    }

    chunks.push(trimmed.slice(start, breakAt).trim());
    // Move forward with overlap
    start = breakAt - OVERLAP_CHARS;
    if (start < 0) start = 0;
    // Avoid infinite loop
    if (start <= (breakAt - MAX_CHUNK_CHARS)) {
      start = breakAt;
    }
  }

  return chunks;
}

// Common stop words to filter from tokenization
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "to", "of", "for",
  "and", "or", "not", "with", "this", "that", "was", "are", "be",
  "has", "had", "have", "do", "does", "did", "but", "if", "then",
  "so", "as", "by", "from", "we", "you", "he", "she", "they", "i",
  "my", "your", "our", "its", "no", "yes", "can", "will", "just",
  "how", "what", "when", "where", "who", "which", "why", "all",
  "each", "every", "about", "up", "out", "into", "over", "after",
  "been", "being", "would", "could", "should", "may", "might",
]);

/**
 * Tokenize text into meaningful terms (lowercase, no stop words).
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}
