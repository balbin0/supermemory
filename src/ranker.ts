import type { MemoryRow } from "./database.js";

export interface RankerWeights {
  bm25: number;
  recency: number;
  frequency: number;
  tags: number;
  project: number;
}

export interface ScoredMemory extends MemoryRow {
  final_score: number;
}

const DEFAULT_WEIGHTS: RankerWeights = {
  bm25: 0.55,
  recency: 0.15,
  frequency: 0.05,
  tags: 0.15,
  project: 0.10,
};

// Recency decay constant (lambda). With 0.01, a 30-day-old memory scores 0.74.
const RECENCY_LAMBDA = 0.01;

/**
 * Multi-signal ranking function.
 *
 * Score(q, d) = w1 * BM25_norm + w2 * recency_decay + w3 * freq_norm + w4 * tag_jaccard + w5 * project_match
 */
export function rankResults(
  candidates: MemoryRow[],
  queryTags: string[],
  maxAccessCount: number,
  project?: string,
  weights: RankerWeights = DEFAULT_WEIGHTS
): ScoredMemory[] {
  if (candidates.length === 0) return [];

  // BM25 scores from FTS5 are negative (lower = better match).
  // Find the range for normalization.
  const bm25Scores = candidates.map((c) => c.bm25_score ?? 0);
  const bm25Min = Math.min(...bm25Scores); // best match (most negative)
  const bm25Max = Math.max(...bm25Scores); // worst match (least negative)
  const bm25Range = bm25Max - bm25Min;

  const nowSeconds = Date.now() / 1000;

  const scored: ScoredMemory[] = candidates.map((candidate) => {
    // 1. Normalized BM25 (inverted: best match → 1.0)
    const bm25Raw = candidate.bm25_score ?? 0;
    const bm25Norm =
      bm25Range !== 0 ? (bm25Max - bm25Raw) / bm25Range : 1.0;

    // 2. Recency decay: e^(-lambda * age_in_days)
    const ageDays = (nowSeconds - candidate.created_at) / 86400;
    const recency = Math.exp(-RECENCY_LAMBDA * ageDays);

    // 3. Access frequency: log(1 + count) / log(1 + max_count)
    const freq =
      maxAccessCount > 0
        ? Math.log(1 + candidate.access_count) /
          Math.log(1 + maxAccessCount)
        : 0;

    // 4. Tag Jaccard similarity
    let tagScore = 0;
    if (queryTags.length > 0) {
      const docTags: string[] = JSON.parse(candidate.tags || "[]");
      if (docTags.length > 0) {
        const querySet = new Set(queryTags.map((t) => t.toLowerCase()));
        const docSet = new Set(docTags.map((t) => t.toLowerCase()));
        const intersection = [...querySet].filter((t) => docSet.has(t)).length;
        const union = new Set([...querySet, ...docSet]).size;
        tagScore = union > 0 ? intersection / union : 0;
      }
    }

    // 5. Project match: 1.0 if memory source matches current project, 0.0 otherwise
    const projectScore =
      project && candidate.source
        ? candidate.source.toLowerCase() === project.toLowerCase()
          ? 1.0
          : 0.0
        : 0.0;

    const final_score =
      weights.bm25 * bm25Norm +
      weights.recency * recency +
      weights.frequency * freq +
      weights.tags * tagScore +
      weights.project * projectScore;

    return { ...candidate, final_score };
  });

  // Sort descending by final score
  scored.sort((a, b) => b.final_score - a.final_score);

  return scored;
}
