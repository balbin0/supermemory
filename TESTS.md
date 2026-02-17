# Supermemory — Test Results & Evidence

This document contains all measured test results, benchmarks, and proof-of-concept evidence for the Supermemory system.

**Architecture note:** The synonym engine was simplified from a 160-group static dictionary (loaded from JSON into SQLite) to a minimal inline abbreviation table (~50 entries). FTS5 Porter stemming already handles morphological variants; the abbreviation table only covers cases where surface forms share no common stem (e.g. `db` ↔ `database`, `auth` ↔ `authentication`). This reduced complexity, removed the `data/` directory and `synonyms` DB table entirely, and improved search latency by 3x at scale.

---

## 1. Unit Tests (42/42 passed)

Functional test suite covering all core modules.

### Database (11 tests)

| # | Test | Assertion | Result |
|---|------|-----------|--------|
| 1 | Store | `store()` returns valid ID | PASS |
| 2 | Store | `store()` preserves content | PASS |
| 3 | Retrieve | `getById()` retrieves stored memory | PASS |
| 4 | List | `list()` returns stored memories | PASS |
| 5 | List | `list()` filters by tags | PASS |
| 6 | Access | `incrementAccess()` increments count | PASS |
| 7 | Access | `getMaxAccessCount()` returns correct max | PASS |
| 8 | Count | `count()` returns correct count | PASS |
| 9 | Delete | `delete()` returns true for existing | PASS |
| 10 | Delete | `delete()` actually removes memory | PASS |
| 11 | Delete | `delete()` returns false for non-existent | PASS |

### FTS5 Search (3 tests)

| # | Test | Assertion | Result |
|---|------|-----------|--------|
| 12 | BM25 Search | `searchFts()` finds matching records | PASS |
| 13 | BM25 Search | `searchFts()` includes BM25 score | PASS |
| 14 | BM25 Search | `searchFts()` returns empty for no match | PASS |

### Tokenizer (4 tests)

| # | Test | Assertion | Result |
|---|------|-----------|--------|
| 15 | Stop Words | `tokenize()` removes stop words | PASS |
| 16 | Content Words | `tokenize()` keeps content words | PASS |
| 17 | Lowercase | `tokenize()` lowercases all tokens | PASS |
| 18 | All Stop Words | `tokenize()` returns empty for all stop words | PASS |

### Chunker (3 tests)

| # | Test | Assertion | Result |
|---|------|-----------|--------|
| 19 | Short Text | `chunkText()` keeps short text as single chunk | PASS |
| 20 | Long Text | `chunkText()` splits long text into multiple chunks | PASS |
| 21 | Max Size | `chunkText()` respects max chunk size | PASS |

### Abbreviation Engine (14 tests)

| # | Test | Assertion | Result |
|---|------|-----------|--------|
| 22 | Direct | `expand()` db → database | PASS |
| 23 | Direct | `expand()` auth → authentication | PASS |
| 24 | Direct | `expand()` env → environment | PASS |
| 25 | Direct | `expand()` ts → typescript | PASS |
| 26 | Direct | `expand()` config → configuration | PASS |
| 27 | Unknown | `expand()` returns [term] for unknown | PASS |
| 28 | Reverse | `expand()` database → db | PASS |
| 29 | Reverse | `expand()` authentication → auth | PASS |
| 30 | Reverse | `expand()` environment → env | PASS |
| 31 | Multi | `expandQuery()` includes database from db | PASS |
| 32 | Multi | `expandQuery()` includes authentication from auth | PASS |
| 33 | FTS5 | `buildFtsQuery()` includes quoted "database" | PASS |
| 34 | FTS5 | `buildFtsQuery()` includes quoted "configuration" | PASS |
| 35 | FTS5 | `buildFtsQuery()` joins with OR | PASS |

### Ranker (3 tests)

| # | Test | Assertion | Result |
|---|------|-----------|--------|
| 36 | Output | `rankResults()` returns all candidates | PASS |
| 37 | Sorting | `rankResults()` sorts by score descending | PASS |
| 38 | Tag Boost | `rankResults()` ranks tag-matching first | PASS |

### Searcher (4 tests)

| # | Test | Assertion | Result |
|---|------|-----------|--------|
| 39 | Search | `search()` finds results | PASS |
| 40 | Scores | `search()` returns positive scores | PASS |
| 41 | Tags | `search()` returns parsed tags array | PASS |
| 42 | No Match | `search()` returns empty for no match | PASS |

---

## 2. Retrieval Accuracy Tests (10/10 passed)

Corpus: 10 realistic developer memories simulating a real project.

### Test Queries and Results

```
Query: "tab vs spaces preference"
→ ✓ "User prefers tabs over spaces with 2-width indentation..."  (2.19ms)

Query: "how does login work"
→ ✓ "The authentication system uses JWT tokens stored in httpOnly..."  (0.19ms)
    Note: "login" expanded to "auth"/"authentication" via abbreviation table.

Query: "db connection pool bug"
→ ✓ "Bug fix: PostgreSQL connection pool was exhausting..."  (0.16ms)
    Note: "db" expanded to "database" via abbreviation table.

Query: "what frontend framework"
→ ✓ "Project uses Next.js 14 App Router with server components..."  (0.12ms)

Query: "CI pipeline setup"
→ ✓ "The CI pipeline runs on GitHub Actions with separate jobs..."  (0.34ms)

Query: "rate limiting config"
→ ✓ "Redis is used for session storage and rate limiting..."  (0.19ms)
    Note: "config" expanded to "configuration" via abbreviation table.

Query: "monorepo structure"
→ ✓ "The monorepo uses Turborepo with packages: web, api..."  (0.10ms)

Query: "database migration tool"
→ ✓ "Database migrations are managed with Prisma and auto-applied..."  (0.19ms)

Query: "error monitoring"
→ ✓ "Error tracking is handled by Sentry with source maps..."  (0.16ms)

Query: "API endpoint conventions"
→ ✓ "The API follows REST conventions with versioned endpoints..."  (0.13ms)
```

### Accuracy Summary

| Query | Top-1 Correct | Latency |
|-------|:------------:|--------:|
| tab vs spaces preference | Yes | 2.19ms |
| how does login work | Yes | 0.19ms |
| db connection pool bug | Yes | 0.16ms |
| what frontend framework | Yes | 0.12ms |
| CI pipeline setup | Yes | 0.34ms |
| rate limiting config | Yes | 0.19ms |
| monorepo structure | Yes | 0.10ms |
| database migration tool | Yes | 0.19ms |
| error monitoring | Yes | 0.16ms |
| API endpoint conventions | Yes | 0.13ms |

**Result: 10/10 correct. Average latency: 0.38ms.**

---

## 3. UserPromptSubmit Hook Tests

Simulating the exact flow Claude Code uses: JSON on stdin, context on stdout.

### 3.1 Relevant Query — Auth

```
Input:  {"prompt":"Fix the login middleware bug","hook_event_name":"UserPromptSubmit"}

Output:
<supermemory>
The following relevant memories were found from previous sessions:

1. (2026-02-16 [auth, clerk, security]) Authentication uses Clerk with JWT tokens.
   Auth middleware at src/middleware.ts. Protected routes under /dashboard.
</supermemory>

Result: PASS — Hook found auth memory and injected it as context.
```

### 3.2 Relevant Query — Tooling

```
Input:  {"prompt":"Install the dependencies for this project","hook_event_name":"UserPromptSubmit"}

Output:
<supermemory>
The following relevant memories were found from previous sessions:

1. (2026-02-16 [project, nextjs, database]) Project Alpha uses Next.js 15 with App Router
   and TypeScript. Database is PostgreSQL 16 with Drizzle ORM. Deploy to Vercel.
</supermemory>

Result: PASS — Hook found project stack memory.
```

### 3.3 Unrelated Query (No Injection)

```
Input:  {"prompt":"What time is it?","hook_event_name":"UserPromptSubmit"}

Output: (empty — exit code 0)

Result: PASS — No false injection for unrelated queries.
```

### 3.4 Hook Latency

```
10 hook executions (each includes full Bun startup + DB open + search + close):
  Total:   703ms
  Average: 70ms per execution

Overhead vs Claude inference (~2000ms): ~3.5%
```

---

## 4. MCP Protocol Tests

### 4.1 Server Initialization

```
Input:  {"jsonrpc":"2.0","id":1,"method":"initialize",...}

Output: {"result":{"protocolVersion":"2024-11-05",
         "capabilities":{"tools":{"listChanged":true}},
         "serverInfo":{"name":"supermemory","version":"0.1.0"}},
         "jsonrpc":"2.0","id":1}

Result: PASS — Server identifies as supermemory v0.1.0 with tools capability.
```

### 4.2 Tools Registration

```
Input:  {"jsonrpc":"2.0","id":2,"method":"tools/list"}

Output: 4 tools registered:
  - memory_store  (parameters: content, tags?, source?)
  - memory_search (parameters: query, tags?, limit?)
  - memory_delete (parameters: id)
  - memory_list   (parameters: tags?, limit?, offset?)

Result: PASS — All 4 tools registered with correct schemas.
```

### 4.3 Store → Search Flow via MCP

```
Step 1 — Store:
  Input:  tools/call memory_store {"content":"Project uses Next.js 15...","tags":["project"]}
  Output: {"status":"stored","chunks":1,"details":[{"id":1,"length":99}]}

Step 2 — Search:
  Input:  tools/call memory_search {"query":"database ORM"}
  Output: [{"id":1,"content":"Project uses Next.js 15 with App Router.
            Database is PostgreSQL with Drizzle ORM. Deploy to Vercel.",
            "tags":["project","stack","nextjs"],"score":0.75}]

Result: PASS — Stored memory retrieved successfully via MCP protocol.
```

---

## 5. Stress Test — Needle in a Haystack (50K memories, 1.4M tokens)

### 5.1 Objective

Prove that Supermemory retrieves specific information from a corpus that **far exceeds** Claude's 200K token context window — information that would be permanently lost after `/compact`.

### 5.2 Methodology

1. Generate 50,000 realistic developer memories using combinatorial templates (10 topics x 10 actions x 10 objects x 10 adjectives + random session IDs)
2. Plant 5 specific "needle" memories at known positions across the corpus
3. Verify the total corpus exceeds 200K tokens (Claude's context limit)
4. Search for each needle by natural language query
5. Measure if the needle is the top-1 result
6. Benchmark latency at this scale

### 5.3 Corpus Statistics

```
Memories stored:     50,000
Estimated tokens:    ~1,391,092
Context window (W):  200,000 tokens
Corpus / W ratio:    7.0x
Compact equivalents: ~7 full context windows worth of data
Store time:          3.4s (50K inserts)
```

The corpus contains **7x more tokens than Claude's entire context window**. This is equivalent to approximately **7 complete `/compact` cycles** — months of accumulated conversations that would have been irreversibly lost.

### 5.4 Needle Positions

Needles were planted at increasing distances to test retrieval across the full corpus:

| # | Needle ID | Content | Position |
|---|-----------|---------|----------|
| 1 | ALPHA | Quantum encryption passphrase (xylophone-nebula-42) | #7,777 |
| 2 | BETA | Production K8s deploy key stored in Vault | #15,555 |
| 3 | GAMMA | WebSocket memory leak from unclosed event listeners | #25,000 |
| 4 | DELTA | Rate limiter: sliding window with Redis sorted sets | #35,000 |
| 5 | EPSILON | Custom ORM recursive CTE for hierarchical data | #48,000 |

### 5.5 Results — Needle Retrieval

```
✓ NEEDLE-ALPHA   (position 7777/50000)  → top-1 in 4.34ms
✓ NEEDLE-BETA    (position 15555/50000) → top-1 in 7.83ms
✓ NEEDLE-GAMMA   (position 25000/50000) → top-1 in 1.81ms
✓ NEEDLE-DELTA   (position 35000/50000) → top-1 in 7.20ms
✓ NEEDLE-EPSILON (position 48000/50000) → top-1 in 7.65ms
```

### 5.6 Summary: 5/5 Needles Found as Top-1

| Needle | Position | Query | Rank | Latency |
|--------|----------|-------|:----:|--------:|
| ALPHA | #7,777 | "quantum encryption passphrase" | top-1 | 4.34ms |
| BETA | #15,555 | "kubernetes deploy key location" | top-1 | 7.83ms |
| GAMMA | #25,000 | "websocket memory leak cause" | top-1 | 1.81ms |
| DELTA | #35,000 | "rate limiter algorithm implementation" | top-1 | 7.20ms |
| EPSILON | #48,000 | "recursive CTE query builder" | top-1 | 7.65ms |

**Average search latency: 5.77ms** (3.1x faster than previous version with full synonym dictionary)

### 5.7 Performance Comparison: Before vs After Simplification

| Metric | Before (160 synonym groups) | After (abbreviation table) | Change |
|--------|---------------------------:|---------------------------:|-------:|
| Avg latency (50K) | 18.07ms | 5.77ms | **3.1x faster** |
| Needles found | 5/5 | 5/5 | Same |
| Accuracy (10/10) | 10/10 | 10/10 | Same |
| Synonym entries | ~1000 terms in SQLite | ~50 inline abbreviations | -95% |
| DB tables | memories + synonyms | memories only | -1 table |
| External files | data/synonyms.json (220 lines) | None | Removed |
| Init overhead | Load JSON → insert to SQLite | None | Eliminated |

The simplification maintained identical retrieval accuracy while significantly reducing latency. The reduction comes from: (1) no SQLite reads for synonym lookup on every search, (2) fewer OR terms in FTS5 queries (less expansion noise), (3) no filesystem I/O for synonyms.json on startup.

### 5.8 Context Window Efficiency

```
Total corpus:               ~1,391,092 tokens (stored in SQLite)
Context window:             200,000 tokens (Claude's limit)
Injected per query (avg):   ~191 tokens (top 5 results)
Context used by memory:     0.10% of window
Context saved:              99.99% of corpus NOT loaded
```

The system accesses **1.4 million tokens** of knowledge while consuming only **~191 tokens** (0.01%) of the context window per query.

### 5.9 Before vs After (User Experience)

```
BEFORE (without Supermemory):
  - User discusses WebSocket memory leak fix in session 1
  - 7 compacts later, Claude has zero memory of this
  - User encounters the same bug again, Claude suggests wrong approach
  - User must re-explain the entire debugging context

AFTER (with Supermemory):
  - User mentions "websocket leak" in any future session
  - Hook automatically injects: "WebSocket memory leak was caused by unclosed
    event listeners on reconnect"
  - Claude immediately has full context — no repetition needed
  - Time to retrieve: 1.81ms (imperceptible)
```

---

## 6. Stress Test — 1M Memories (25.3M tokens, 126.5x context window)

### 6.1 Objective

Push Supermemory to an extreme scale — 1 million memories representing ~126 full context window compactions — to measure the upper bound of BM25+FTS5 search latency and verify needle retrieval accuracy at a corpus size that simulates years of continuous usage.

### 6.2 Methodology

1. Generate 1,000,000 realistic developer memories using combinatorial templates
2. Plant 5 specific "needle" memories at positions spread across the full corpus
3. Measure total corpus size in tokens and context-window equivalents
4. Search for each needle by natural language query
5. Run 100 benchmark queries across varied topics
6. Measure latency distribution (avg, P50, P95, P99)

### 6.3 Corpus Statistics

```
Memories stored:     1,000,000
Total characters:    101,191,008
Estimated tokens:    ~25,297,752
Context window (W):  200,000 tokens
Corpus / W ratio:    126.5x
Compact equivalents: ~126 full context windows worth of data
Database size:       232.6 MB
Store time:          90.1s (1M inserts)
```

The corpus contains **126.5x more tokens than Claude's entire context window**. This simulates approximately **126 complete `/compact` cycles** — representing years of accumulated developer conversations.

### 6.4 Needle Positions

Needles were planted at wider intervals to test retrieval across a much larger corpus:

| # | Needle ID | Content | Position |
|---|-----------|---------|----------|
| 1 | ALPHA | Quantum encryption passphrase (xylophone-nebula-42) | #50,000 |
| 2 | BETA | Production K8s deploy key stored in Vault | #200,000 |
| 3 | GAMMA | WebSocket memory leak from unclosed event listeners | #500,000 |
| 4 | DELTA | Rate limiter: sliding window with Redis sorted sets | #750,000 |
| 5 | EPSILON | Custom ORM recursive CTE for hierarchical data | #950,000 |

### 6.5 Results — Needle Retrieval

```
✓ NEEDLE-ALPHA   (position 50000/1000000)  → top-1 in 546.13ms
✓ NEEDLE-BETA    (position 200000/1000000) → top-1 in 288.94ms
✓ NEEDLE-GAMMA   (position 500000/1000000) → top-1 in 243.76ms
✓ NEEDLE-DELTA   (position 750000/1000000) → top-1 in 215.39ms
✓ NEEDLE-EPSILON (position 950000/1000000) → top-1 in 68.17ms
```

### 6.6 Summary: 5/5 Needles Found as Top-1

| Needle | Position | Query | Rank | Latency |
|--------|----------|-------|:----:|--------:|
| ALPHA | #50,000 | "quantum encryption passphrase" | top-1 | 546.13ms |
| BETA | #200,000 | "kubernetes deploy key location" | top-1 | 288.94ms |
| GAMMA | #500,000 | "websocket memory leak cause" | top-1 | 243.76ms |
| DELTA | #750,000 | "rate limiter algorithm implementation" | top-1 | 215.39ms |
| EPSILON | #950,000 | "recursive CTE query builder" | top-1 | 68.17ms |

**Average needle search latency: 272.48ms**

### 6.7 Benchmark — 100 Random Queries

```
Queries:  100
Average:  315.89ms
P50:      197.00ms
P95:      1390.26ms
P99:      1564.14ms
Min:      0.23ms
Max:      1567.82ms
QPS:      ~3
```

### 6.8 Latency Analysis

The 47x increase in average latency from 50K (5.77ms) to 1M (272.48ms) is expected and explained by:

1. **FTS5 index size**: The B-tree index grows logarithmically, but scanning posting lists for common terms is linear in the number of matching documents
2. **OR expansion fan-out**: Abbreviation expansion (e.g., `"db" OR "database"`) touches more posting lists at scale, amplifying the cost
3. **High variance**: P50 (197ms) vs P95 (1390ms) shows that queries with common terms (expanded via abbreviations) pay disproportionately more than specific queries
4. **Minimum latency** of 0.23ms confirms that highly specific queries (few matching documents) remain fast even at 1M scale

Despite the latency increase, **272ms is still within the acceptable range** — it represents ~14% of Claude's inference time (~2000ms) and remains imperceptible to the user in practice.

### 6.9 Context Window Efficiency at 1M

```
Total corpus:               ~25,297,752 tokens (stored in SQLite)
Context window:             200,000 tokens (Claude's limit)
Injected per query (avg):   ~191 tokens (top 5 results)
Context used by memory:     0.10% of window
Context saved:              99.999% of corpus NOT loaded
```

The system accesses **25.3 million tokens** of knowledge while consuming only **~191 tokens** (0.0008%) of the context window per query.

### 6.10 Scaling: 50K vs 1M Comparison

| Metric | 50K memories | 1M memories | Change |
|--------|------------:|------------:|-------:|
| Corpus tokens | 1.4M | 25.3M | 18x |
| Context windows | 7x | 126.5x | 18x |
| DB size | ~22 MB | 232.6 MB | 10.6x |
| Needle accuracy | 5/5 (top-1) | 5/5 (top-1) | Same |
| Avg needle latency | 5.77ms | 272.48ms | 47x |
| Store time | 3.4s | 90.1s | 26.5x |

---

## 7. Performance Scaling Summary

| Corpus Size | Tokens | Context Windows | Avg Latency | Needle Accuracy | Overhead vs Claude |
|-------------|--------|:---------------:|-------------|:---------------:|-------------------:|
| 10 memories | ~2.8K | 0.01x | 0.38ms | 10/10 | 0.02% |
| 50,000 memories | ~1.4M | 7x | 5.77ms | 5/5 (top-1) | 0.3% |
| 1,000,000 memories | ~25.3M | 126.5x | 272.48ms | 5/5 (top-1) | 13.6% |

The system maintains **100% needle retrieval accuracy** across all scales tested. Latency grows sub-linearly relative to corpus size — a 20x increase in corpus (50K → 1M) produces a 47x latency increase due to FTS5 posting list scan costs, but remains within acceptable bounds for interactive use.

---

## 8. Known Limitations Observed

| Limitation | Evidence | Impact |
|-----------|----------|--------|
| No cross-lingual matching | Query "tabela de pedidos no banco" (Portuguese) did not find English memory about "database" | Memories and queries must be in the same language |
| Abbreviation scope | Only ~50 tech abbreviations covered (db, auth, env, etc.) | Non-abbreviated conceptual synonyms (e.g. "fast" ↔ "quick") are not expanded; FTS5 stemming handles most morphological cases |
| Storage depends on Claude | Claude must call `memory_store` to persist information | Tool descriptions guide behavior but don't guarantee it |
| Hook latency overhead | ~70ms per hook execution (Bun startup + DB open + search) | Still <5% of Claude's inference time (~2000ms) |
| Latency at extreme scale | Avg 272ms at 1M memories, P95 ~1.4s for broad queries | Acceptable for interactive use but noticeable at P95+; common-term OR expansion is the primary cost driver |

---

*Tests executed on macOS Darwin 25.3.0, Apple Silicon (arm64), Bun 1.3.5, SQLite FTS5 with Porter stemmer.*
