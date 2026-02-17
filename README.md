# Supermemory

Zero-AI persistent memory for Claude Code. One command to install, invisible after that.

Claude gets smarter with every session — remembering your projects, preferences, bugs, and decisions across conversations, even after `/compact`.

## How it works

Supermemory uses a **dual-layer architecture**:

- **Layer 1 (Automatic)**: A `UserPromptSubmit` hook fires on every message, searches memory, and injects relevant context *before* Claude processes your prompt. Guaranteed, zero effort.
- **Layer 2 (Active)**: Four MCP tools let Claude store new memories, search, delete, and list. Claude decides what's worth remembering.

No neural embeddings, no external APIs, no cloud. Just SQLite + FTS5 + BM25 running locally.

## Installation

```bash
bunx supermemory init
```

That's it. Restart Claude Code and you're done.

The `init` command:
1. Creates `~/.supermemory/memory.db`
2. Configures the MCP server in `~/.claude/settings.json`
3. Configures the `UserPromptSubmit` hook for automatic retrieval

## Features

| Feature | Description |
|---------|-------------|
| Automatic retrieval | Hook injects relevant memories on every message |
| Intelligent storage | Claude decides what to store via MCP tools |
| Multi-signal ranking | BM25 + recency decay + access frequency + tag matching + project boost |
| Project isolation | Auto-detects project from `cwd`, prioritizes same-project memories |
| Abbreviation expansion | `db` finds `database`, `auth` finds `authentication` (~50 entries) |
| Export/Import | Migrate memories between machines with JSON |
| Chunking | Large content is split into searchable chunks with overlap |
| Single-file storage | Everything lives in one SQLite file |

## CLI Commands

| Command | Purpose |
|---------|---------|
| `supermemory init` | Setup database + configure Claude Code |
| `supermemory serve` | Start MCP server (automatic via Claude Code) |
| `supermemory hook` | Run as UserPromptSubmit hook (automatic) |
| `supermemory export [file]` | Export all memories to JSON (stdout if no file) |
| `supermemory import <file>` | Import memories from JSON (skips duplicates) |

## MCP Tools

Claude has access to four tools:

- **`memory_store`** — Store important information (decisions, bugs, preferences, patterns)
- **`memory_search`** — Search memories by natural language query
- **`memory_delete`** — Delete a memory by ID
- **`memory_list`** — List stored memories with optional tag filter

## Export / Import

```bash
# Export from machine A
supermemory export memories.json

# Import on machine B
supermemory import memories.json
# → 42 added, 0 duplicates skipped.
```

The import command deduplicates automatically — re-importing the same file is safe.

## Project Isolation

Supermemory auto-detects the current project from the working directory:

```
cwd: /Users/you/Code/my-saas     → source: "my-saas"
cwd: /Users/you/Code/api-server  → source: "api-server"
```

- **Storing**: `source` is auto-populated if not explicitly set
- **Searching**: Same-project memories get a ranking boost
- **Cross-project**: Memories from other projects still appear if relevant

## How Claude Interacts

You don't need to do anything. But you can:

| You say | Claude does |
|---------|-------------|
| "What do you remember about this project?" | `memory_search(...)` |
| "Forget the decision about Redis" | `memory_delete(id)` |
| "Remember: always use tabs, never spaces" | `memory_store(...)` |
| "Show me everything you have stored" | `memory_list()` |

## Data Ownership

All data stays on your machine. No cloud, no telemetry, no external calls.

```bash
# Where is my data?
~/.supermemory/memory.db

# Back it up
cp ~/.supermemory/memory.db ~/backup/

# Move to another machine
supermemory export backup.json
# (transfer file)
supermemory import backup.json

# Inspect manually
sqlite3 ~/.supermemory/memory.db "SELECT * FROM memories ORDER BY created_at DESC LIMIT 10"

# Delete everything
rm ~/.supermemory/memory.db

# Uninstall
rm -rf ~/.supermemory
# Remove "supermemory" from ~/.claude/settings.json
```

## Performance

| Corpus | Latency | Accuracy | Overhead |
|--------|---------|:--------:|--------:|
| 10 memories | 0.38ms | 10/10 | 0.02% |
| 50K memories | 5.77ms | 5/5 top-1 | 0.3% |
| 1M memories | 272ms | 5/5 top-1 | 13.6% |

Hook execution (Bun startup + DB + search): ~70ms per message (~3.5% of Claude's inference time).

See [PAPER.md](./PAPER.md) for the full technical paper and [TESTS.md](./TESTS.md) for all test evidence.

## Architecture

```
supermemory/
├── src/
│   ├── index.ts        # CLI entry point (init, serve, hook, export, import)
│   ├── database.ts     # SQLite + FTS5 setup and operations
│   ├── indexer.ts       # Chunking, tokenization, stop word removal
│   ├── searcher.ts      # Query expansion, FTS5 search, fallback chain
│   ├── ranker.ts        # Multi-signal scoring (5 signals)
│   └── synonyms.ts      # Abbreviation expansion (~50 inline entries)
├── package.json
├── tsconfig.json
├── PAPER.md             # Technical paper
└── TESTS.md             # Test results and evidence
```

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Bun (built-in SQLite, native TS) |
| Database | bun:sqlite + FTS5 (zero deps) |
| Search | BM25 + Porter stemming |
| Protocol | MCP via stdio |
| Distribution | `bunx supermemory` (zero install) |

---

*Supermemory — Because memory should be a solved problem, not a limitation.*
# supermemory
