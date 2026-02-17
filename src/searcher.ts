import { MemoryDatabase } from "./database.js";
import { SynonymEngine } from "./synonyms.js";
import { tokenize } from "./indexer.js";
import { rankResults, type ScoredMemory } from "./ranker.js";

export interface SearchOptions {
  query: string;
  tags?: string[];
  limit?: number;
  minScore?: number;
  project?: string;
}

export interface SearchResult {
  id: number;
  content: string;
  tags: string[];
  score: number;
  created_at: number;
  source: string | null;
}

export class Searcher {
  constructor(
    private db: MemoryDatabase,
    private synonyms: SynonymEngine
  ) {}

  search(options: SearchOptions): SearchResult[] {
    const { query, tags = [], limit = 5, minScore = 0.1, project } = options;

    // Step 1: Tokenize query
    const terms = tokenize(query);
    if (terms.length === 0) {
      // Fallback: if tokenization yields nothing, try raw query
      return this.fallbackSearch(query, tags, limit, project);
    }

    // Step 2: Expand with synonyms → build FTS5 MATCH expression
    const ftsQuery = this.synonyms.buildFtsQuery(terms);
    if (!ftsQuery) return [];

    // Step 3: FTS5 BM25 search (over-fetch 3x for re-ranking headroom)
    const overFetchLimit = limit * 3;
    let candidates = this.db.searchFts(ftsQuery, overFetchLimit);

    // If FTS returns nothing, try without synonym expansion
    if (candidates.length === 0) {
      const plainQuery = terms.join(" OR ");
      candidates = this.db.searchFts(plainQuery, overFetchLimit);
    }

    if (candidates.length === 0) return [];

    // Step 4: Multi-signal re-ranking
    const maxAccess = this.db.getMaxAccessCount();
    const ranked = rankResults(candidates, tags, maxAccess, project);

    // Step 5: Filter by min score and take top-k
    const filtered = ranked
      .filter((r) => r.final_score >= minScore)
      .slice(0, limit);

    // Step 6: Update access counts
    for (const result of filtered) {
      this.db.incrementAccess(result.id);
    }

    // Map to clean output
    return filtered.map(toSearchResult);
  }

  private fallbackSearch(
    query: string,
    tags: string[],
    limit: number,
    project?: string
  ): SearchResult[] {
    // Direct FTS match on raw query (no expansion)
    try {
      const candidates = this.db.searchFts(`"${query}"`, limit);
      if (candidates.length === 0) return [];
      const maxAccess = this.db.getMaxAccessCount();
      const ranked = rankResults(candidates, tags, maxAccess, project);
      for (const r of ranked) this.db.incrementAccess(r.id);
      return ranked.slice(0, limit).map(toSearchResult);
    } catch {
      return [];
    }
  }
}

function toSearchResult(r: ScoredMemory): SearchResult {
  return {
    id: r.id,
    content: r.content,
    tags: JSON.parse(r.tags || "[]"),
    score: Math.round(r.final_score * 1000) / 1000,
    created_at: r.created_at,
    source: r.source,
  };
}
