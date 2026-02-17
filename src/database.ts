import { Database } from "bun:sqlite";
import { resolve } from "path";
import { mkdirSync, existsSync } from "fs";

export interface Memory {
  id: number;
  content: string;
  tags: string;
  source: string | null;
  created_at: number;
  updated_at: number;
  access_count: number;
  metadata: string;
}

export interface MemoryRow extends Memory {
  bm25_score?: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    content      TEXT NOT NULL,
    tags         TEXT DEFAULT '[]',
    source       TEXT,
    created_at   REAL NOT NULL,
    updated_at   REAL NOT NULL,
    access_count INTEGER DEFAULT 0,
    metadata     TEXT DEFAULT '{}'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    tags,
    content='memories',
    content_rowid='id',
    tokenize='porter unicode61'
  );

  -- Triggers to keep FTS index in sync with memories table
  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags)
    VALUES (new.id, new.content, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags)
    VALUES ('delete', old.id, old.content, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags)
    VALUES ('delete', old.id, old.content, old.tags);
    INSERT INTO memories_fts(rowid, content, tags)
    VALUES (new.id, new.content, new.tags);
  END;

  CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
`;

export class MemoryDatabase {
  private db: Database;

  constructor(dbPath: string) {
    const dir = resolve(dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.run(SCHEMA);
  }

  store(
    content: string,
    tags: string[] = [],
    source?: string,
    metadata: Record<string, unknown> = {}
  ): Memory {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      INSERT INTO memories (content, tags, source, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tagsJson = JSON.stringify(tags);
    const metaJson = JSON.stringify(metadata);
    const result = stmt.run(content, tagsJson, source ?? null, now, now, metaJson);

    return {
      id: Number(result.lastInsertRowid),
      content,
      tags: tagsJson,
      source: source ?? null,
      created_at: now,
      updated_at: now,
      access_count: 0,
      metadata: metaJson,
    };
  }

  searchFts(query: string, limit: number = 15): MemoryRow[] {
    const stmt = this.db.prepare(`
      SELECT
        m.*,
        bm25(memories_fts) AS bm25_score
      FROM memories_fts f
      JOIN memories m ON m.id = f.rowid
      WHERE memories_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `);
    return stmt.all(query, limit) as MemoryRow[];
  }

  getById(id: number): Memory | null {
    const stmt = this.db.prepare("SELECT * FROM memories WHERE id = ?");
    return (stmt.get(id) as Memory) ?? null;
  }

  delete(id: number): boolean {
    const stmt = this.db.prepare("DELETE FROM memories WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  list(limit: number = 20, offset: number = 0, tags?: string[]): Memory[] {
    if (tags && tags.length > 0) {
      const placeholders = tags.map(() => `m.tags LIKE ?`).join(" OR ");
      const stmt = this.db.prepare(`
        SELECT * FROM memories m
        WHERE ${placeholders}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `);
      const params = tags.map((t) => `%"${t}"%`);
      return stmt.all(...params, limit, offset) as Memory[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as Memory[];
  }

  incrementAccess(id: number): void {
    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, updated_at = ?
      WHERE id = ?
    `).run(Date.now() / 1000, id);
  }

  getMaxAccessCount(): number {
    const row = this.db.prepare(
      "SELECT MAX(access_count) as max_count FROM memories"
    ).get() as { max_count: number | null } | null;
    return row?.max_count ?? 0;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as {
      count: number;
    };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}
