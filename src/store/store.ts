import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RunRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  found: number;
  file: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (
  job_key TEXT PRIMARY KEY,
  link TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  percent INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  collected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  found INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL
);
`;

/** Settings, the links already delivered (so a new run never repeats them) and past runs. Nothing sensitive is kept. */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  getJson<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  setJson(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  historyKeys(): Set<string> {
    return new Set((this.db.prepare('SELECT job_key FROM history').all() as { job_key: string }[]).map((r) => r.job_key));
  }

  historyCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM history').get() as { n: number }).n;
  }

  remember(runId: string, j: { jobKey: string; link: string; title: string; company: string; percent: number }): void {
    this.db
      .prepare('INSERT OR IGNORE INTO history (job_key, link, title, company, percent, run_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(j.jobKey, j.link, j.title, j.company, j.percent, runId);
  }

  clearHistory(): void {
    this.db.exec('DELETE FROM history');
  }

  saveRun(r: RunRecord): void {
    this.db
      .prepare(
        'INSERT INTO runs (id, started_at, ended_at, found, file) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, found = excluded.found',
      )
      .run(r.id, r.startedAt, r.endedAt, r.found, r.file);
  }

  runs(limit = 20): RunRecord[] {
    return (this.db.prepare('SELECT id, started_at, ended_at, found, file FROM runs ORDER BY started_at DESC LIMIT ?').all(limit) as {
      id: string;
      started_at: string;
      ended_at: string | null;
      found: number;
      file: string;
    }[]).map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at, found: r.found, file: r.file }));
  }

  /** Runs left open by a closed window. */
  closeInterrupted(): void {
    this.db.prepare("UPDATE runs SET ended_at = datetime('now') WHERE ended_at IS NULL").run();
  }

  close(): void {
    this.db.close();
  }
}
