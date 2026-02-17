#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve, basename } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

import { MemoryDatabase } from "./database.js";
import { SynonymEngine } from "./synonyms.js";
import { Searcher } from "./searcher.js";
import { chunkText } from "./indexer.js";

// ─── Paths ───────────────────────────────────────────────────────────────────

const HOME = process.env.HOME || process.env.USERPROFILE || "~";
const DEFAULT_DB_PATH = resolve(HOME, ".supermemory", "memory.db");
const CLAUDE_SETTINGS_PATH = resolve(HOME, ".claude", "settings.json");

function getDbPath(): string {
  return process.env.SUPERMEMORY_DB
    ? resolve(process.env.SUPERMEMORY_DB.replace("~", HOME))
    : DEFAULT_DB_PATH;
}

/** Derive project name from a directory path (uses basename). */
function getProjectName(cwd?: string): string | undefined {
  const dir = cwd || process.env.SUPERMEMORY_PROJECT;
  if (!dir) return undefined;
  const name = basename(dir);
  // Ignore home directory or root
  return name && name !== "/" && name !== HOME.split("/").pop()
    ? name
    : undefined;
}

// ─── Init Command ────────────────────────────────────────────────────────────

async function runInit() {
  const dbPath = getDbPath();

  // 1. Initialize database
  console.log(`[supermemory] Initializing database at ${dbPath}`);
  const db = new MemoryDatabase(dbPath);
  const count = db.count();
  console.log(`[supermemory] Database ready. ${count} memories stored.`);
  db.close();

  // 2. Inject MCP config into Claude settings
  console.log(`[supermemory] Configuring Claude Code...`);
  let settings: Record<string, unknown> = {};

  if (existsSync(CLAUDE_SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
    } catch {
      console.log(`[supermemory] Warning: Could not parse existing settings, creating new.`);
    }
  }

  // 2a. MCP server config
  const mcpServers = (settings.mcpServers as Record<string, unknown>) || {};
  mcpServers.supermemory = {
    command: "bunx",
    args: ["supermemory", "serve"],
    env: {
      SUPERMEMORY_DB: dbPath,
    },
  };
  settings.mcpServers = mcpServers;

  // 2b. UserPromptSubmit hook — auto-injects relevant memories on every message
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};
  const existingHooks = (hooks.UserPromptSubmit as unknown[]) || [];

  // Check if supermemory hook is already configured
  const hookAlreadyExists = existingHooks.some((h: unknown) => {
    const entry = h as Record<string, unknown>;
    const innerHooks = entry.hooks as Record<string, unknown>[] | undefined;
    return innerHooks?.some((ih) =>
      typeof ih.command === "string" && ih.command.includes("supermemory")
    );
  });

  if (!hookAlreadyExists) {
    existingHooks.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command: `SUPERMEMORY_DB="${dbPath}" bunx supermemory hook`,
          timeout: 10,
          statusMessage: "Searching memory...",
        },
      ],
    });
  }

  hooks.UserPromptSubmit = existingHooks;

  settings.hooks = hooks;

  const settingsDir = resolve(CLAUDE_SETTINGS_PATH, "..");
  if (!existsSync(settingsDir)) {
    const { mkdirSync } = await import("fs");
    mkdirSync(settingsDir, { recursive: true });
  }

  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  console.log(`[supermemory] MCP server configured.`);
  console.log(`[supermemory] UserPromptSubmit hook configured (auto-retrieval).`);
  console.log(`[supermemory] Settings written to ${CLAUDE_SETTINGS_PATH}`);
  console.log(`\n[supermemory] Setup complete! Restart Claude Code to activate.`);
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

async function runServe() {
  const dbPath = getDbPath();
  const db = new MemoryDatabase(dbPath);
  const synonymEngine = new SynonymEngine();
  const searcher = new Searcher(db, synonymEngine);
  const currentProject = getProjectName(process.cwd());

  const server = new McpServer({
    name: "supermemory",
    version: "0.1.0",
  });

  // ── memory_store ─────────────────────────────────────────────────────────

  server.tool(
    "memory_store",
    `Store important information that should persist across sessions.
Call this when you discover or establish:
- Architectural decisions and their rationale
- Bug root causes and their fixes
- User preferences (coding style, tools, naming conventions)
- Project structure insights and key file locations
- Solutions to problems that required significant effort
Do NOT store trivial or ephemeral information.`,
    {
      content: z.string().describe("The information to remember. Be specific and include context."),
      tags: z.array(z.string()).optional().describe("Categorical tags for this memory (e.g. ['auth', 'backend', 'bug-fix'])"),
      source: z.string().optional().describe("Origin identifier (e.g. project name, file path)"),
    },
    async ({ content, tags, source }) => {
      const effectiveSource = source ?? currentProject;
      const chunks = chunkText(content);
      const stored = [];

      for (const chunk of chunks) {
        const memory = db.store(chunk, tags ?? [], effectiveSource);
        stored.push({ id: memory.id, length: chunk.length });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "stored",
              chunks: stored.length,
              details: stored,
            }),
          },
        ],
      };
    }
  );

  // ── memory_search ────────────────────────────────────────────────────────

  server.tool(
    "memory_search",
    `Search your persistent memory for relevant context.
ALWAYS call this tool at the start of a new conversation and whenever the user
asks about something that may have been discussed in a previous session.
This gives you knowledge that persists beyond your context window.`,
    {
      query: z.string().describe("Natural language search query"),
      tags: z.array(z.string()).optional().describe("Optional tag filter to narrow results"),
      limit: z.number().optional().describe("Max results to return (default: 5)"),
    },
    async ({ query, tags, limit }) => {
      const results = searcher.search({
        query,
        tags,
        limit: limit ?? 5,
        project: currentProject,
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              results.length > 0
                ? JSON.stringify(results, null, 2)
                : "No relevant memories found.",
          },
        ],
      };
    }
  );

  // ── memory_delete ────────────────────────────────────────────────────────

  server.tool(
    "memory_delete",
    "Delete a specific memory by its ID. Use when the user asks to forget something or when information is outdated.",
    {
      id: z.number().describe("The memory ID to delete"),
    },
    async ({ id }) => {
      const deleted = db.delete(id);
      return {
        content: [
          {
            type: "text" as const,
            text: deleted
              ? `Memory #${id} deleted.`
              : `Memory #${id} not found.`,
          },
        ],
      };
    }
  );

  // ── memory_list ──────────────────────────────────────────────────────────

  server.tool(
    "memory_list",
    "List stored memories, optionally filtered by tags. Use when the user wants to see what you remember.",
    {
      tags: z.array(z.string()).optional().describe("Optional tag filter"),
      limit: z.number().optional().describe("Max results (default: 20)"),
      offset: z.number().optional().describe("Pagination offset (default: 0)"),
    },
    async ({ tags, limit, offset }) => {
      const memories = db.list(limit ?? 20, offset ?? 0, tags);

      const results = memories.map((m) => ({
        id: m.id,
        content:
          m.content.length > 200
            ? m.content.slice(0, 200) + "..."
            : m.content,
        tags: JSON.parse(m.tags || "[]"),
        created_at: new Date(m.created_at * 1000).toISOString(),
        access_count: m.access_count,
        source: m.source,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text:
              results.length > 0
                ? JSON.stringify(results, null, 2)
                : "No memories stored yet.",
          },
        ],
      };
    }
  );

  // ── Start server ─────────────────────────────────────────────────────────

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── Hook Command (UserPromptSubmit) ─────────────────────────────────────────

async function runHook() {
  // Read hook input from stdin (Claude Code sends JSON with { prompt, session_id, cwd, ... })
  const input = await Bun.stdin.text();
  let prompt = "";
  let hookCwd: string | undefined;

  try {
    const data = JSON.parse(input);
    prompt = data.prompt || "";
    hookCwd = data.cwd;
  } catch {
    // If not JSON, treat as plain text prompt
    prompt = input.trim();
  }

  if (!prompt) {
    process.exit(0);
  }

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    process.exit(0);
  }

  const project = getProjectName(hookCwd);
  const db = new MemoryDatabase(dbPath);
  const synonymEngine = new SynonymEngine();
  const searcher = new Searcher(db, synonymEngine);

  const results = searcher.search({ query: prompt, limit: 5, minScore: 0.15, project });
  db.close();

  if (results.length === 0) {
    process.exit(0);
  }

  // Format memories as context that gets injected into Claude's prompt
  const lines = results.map((r, i) => {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
    const date = new Date(r.created_at * 1000).toISOString().split("T")[0];
    return `${i + 1}. (${date}${tags}) ${r.content}`;
  });

  const context = [
    "<supermemory>",
    "The following relevant memories were found from previous sessions:",
    "",
    ...lines,
    "</supermemory>",
  ].join("\n");

  // Write to stdout — Claude Code injects this as additional context
  process.stdout.write(context);
  process.exit(0);
}

// ─── Export Command ──────────────────────────────────────────────────────────

async function runExport() {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    console.error(`[supermemory] Database not found at ${dbPath}`);
    process.exit(1);
  }

  const db = new MemoryDatabase(dbPath);
  const total = db.count();

  // Fetch all memories in batches
  const memories = [];
  const batchSize = 1000;
  for (let offset = 0; offset < total; offset += batchSize) {
    const batch = db.list(batchSize, offset);
    for (const m of batch) {
      memories.push({
        content: m.content,
        tags: JSON.parse(m.tags || "[]"),
        source: m.source,
        created_at: m.created_at,
        metadata: JSON.parse(m.metadata || "{}"),
      });
    }
  }
  db.close();

  const output = JSON.stringify({ version: 1, exported_at: new Date().toISOString(), count: memories.length, memories }, null, 2);

  // Write to file if path provided, otherwise stdout
  const outPath = process.argv[3];
  if (outPath) {
    writeFileSync(resolve(outPath), output + "\n");
    console.log(`[supermemory] Exported ${memories.length} memories to ${outPath}`);
  } else {
    process.stdout.write(output + "\n");
  }
}

// ─── Import Command ──────────────────────────────────────────────────────────

async function runImport() {
  const filePath = process.argv[3];
  if (!filePath) {
    console.error(`[supermemory] Usage: supermemory import <file.json>`);
    process.exit(1);
  }

  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(`[supermemory] File not found: ${resolved}`);
    process.exit(1);
  }

  const raw = readFileSync(resolved, "utf-8");
  const data = JSON.parse(raw);

  if (!data.memories || !Array.isArray(data.memories)) {
    console.error(`[supermemory] Invalid export file (missing "memories" array)`);
    process.exit(1);
  }

  const dbPath = getDbPath();
  const db = new MemoryDatabase(dbPath);

  let imported = 0;
  let skipped = 0;

  for (const m of data.memories) {
    // Deduplicate: skip if exact content already exists
    const existing = db.searchFts(`"${m.content.slice(0, 100).replace(/"/g, "")}"`, 1);
    if (existing.length > 0 && existing[0].content === m.content) {
      skipped++;
      continue;
    }

    db.store(
      m.content,
      m.tags ?? [],
      m.source,
      m.metadata ?? {}
    );
    imported++;
  }

  db.close();
  console.log(`[supermemory] Import complete: ${imported} added, ${skipped} duplicates skipped.`);
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case "init":
    await runInit();
    break;
  case "serve":
  case undefined:
    // Default to serve (MCP servers are spawned without explicit command)
    await runServe();
    break;
  case "hook":
    await runHook();
    break;
  case "export":
    await runExport();
    break;
  case "import":
    await runImport();
    break;
  default:
    console.log(`supermemory v0.1.0 — Zero-AI memory for LLM agents

Usage:
  supermemory init              Setup database and configure Claude Code
  supermemory serve             Start MCP server (usually automatic)
  supermemory hook              Run as UserPromptSubmit hook (automatic)
  supermemory export [file]     Export all memories to JSON (stdout if no file)
  supermemory import <file>     Import memories from JSON (skips duplicates)

Data: ~/.supermemory/memory.db
`);
}
