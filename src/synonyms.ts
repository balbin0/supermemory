/**
 * Abbreviation expansion for FTS5 queries.
 *
 * FTS5 + Porter stemming already handles morphological variants (running → run).
 * The only real gap is abbreviations/acronyms where the surface forms share no
 * common stem. This map is intentionally small — each entry must justify itself.
 */

const ABBREVIATIONS: Record<string, string[]> = {
  // Common aliases (not abbreviations, but universally interchangeable)
  login: ["login", "auth", "authentication", "signin"],
  signin: ["signin", "auth", "authentication", "login"],
  signup: ["signup", "register", "registration"],
  logout: ["logout", "signout"],
  // Tech abbreviations
  db: ["db", "database"],
  auth: ["auth", "authentication", "login"],
  authn: ["authn", "authentication"],
  authz: ["authz", "authorization"],
  js: ["js", "javascript"],
  ts: ["ts", "typescript"],
  py: ["py", "python"],
  env: ["env", "environment"],
  config: ["config", "configuration"],
  repo: ["repo", "repository"],
  deps: ["deps", "dependencies"],
  dev: ["dev", "development"],
  prod: ["prod", "production"],
  pkg: ["pkg", "package"],
  dir: ["dir", "directory"],
  msg: ["msg", "message"],
  req: ["req", "request"],
  res: ["res", "response"],
  fn: ["fn", "function"],
  param: ["param", "parameter"],
  params: ["params", "parameters"],
  args: ["args", "arguments"],
  impl: ["impl", "implementation"],
  info: ["info", "information"],
  err: ["err", "error"],
  doc: ["doc", "document", "documentation"],
  docs: ["docs", "documentation"],
  lib: ["lib", "library"],
  num: ["num", "number"],
  str: ["str", "string"],
  bool: ["bool", "boolean"],
  obj: ["obj", "object"],
  arr: ["arr", "array"],
  idx: ["idx", "index"],
  cmd: ["cmd", "command"],
  cli: ["cli", "command-line"],
  api: ["api", "endpoint"],
  url: ["url", "endpoint", "link"],
  ui: ["ui", "interface"],
  css: ["css", "style", "styling"],
  sql: ["sql", "query", "database"],
  jwt: ["jwt", "token"],
  oauth: ["oauth", "authentication"],
  ssl: ["ssl", "tls", "certificate"],
  dns: ["dns", "domain"],
  ws: ["ws", "websocket"],
  ci: ["ci", "continuous-integration"],
  cd: ["cd", "continuous-deployment"],
  k8s: ["k8s", "kubernetes"],
};

// Build reverse lookup: full form → abbreviation set
const REVERSE_MAP = new Map<string, string[]>();
for (const [, expansions] of Object.entries(ABBREVIATIONS)) {
  for (const term of expansions) {
    if (!REVERSE_MAP.has(term)) {
      REVERSE_MAP.set(term, []);
    }
    for (const sibling of expansions) {
      if (sibling !== term && !REVERSE_MAP.get(term)!.includes(sibling)) {
        REVERSE_MAP.get(term)!.push(sibling);
      }
    }
  }
}

export class SynonymEngine {
  /** Expand a single term. Returns [term] if no expansion exists. */
  expand(term: string): string[] {
    const lower = term.toLowerCase();

    // Direct abbreviation lookup
    const direct = ABBREVIATIONS[lower];
    if (direct) return direct;

    // Reverse lookup (full form → abbreviation)
    const reverse = REVERSE_MAP.get(lower);
    if (reverse) return [lower, ...reverse];

    return [lower];
  }

  /** Expand all terms in a query. Returns deduplicated array. */
  expandQuery(terms: string[]): string[] {
    const expanded = new Set<string>();
    for (const term of terms) {
      for (const synonym of this.expand(term)) {
        expanded.add(synonym);
      }
    }
    return [...expanded];
  }

  /** Build an FTS5 MATCH expression from expanded terms. */
  buildFtsQuery(terms: string[]): string {
    const expanded = this.expandQuery(terms);
    const safeTerms = expanded
      .filter((t) => /^[a-z0-9_-]+$/i.test(t))
      .map((t) => `"${t}"`);
    if (safeTerms.length === 0) return terms.map((t) => `"${t}"`).join(" OR ");
    return safeTerms.join(" OR ");
  }
}
