import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverStalledBroadcasts, getQueuedBroadcasts } from '../src/broadcasts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  return db;
}

/** Wraps better-sqlite3 to look like a D1Database (async API). */
function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const make = (params: unknown[]) => ({
        async run() {
          const info = sqlite.prepare(query).run(...params);
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...params) as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
        },
      });
      return { bind: (...params: unknown[]) => make(params), ...make([]) };
    },
  } as unknown as D1Database;
}

const TAG_MARKER = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 't1' }] });

interface BcastOverrides {
  id: string;
  status?: string;
  batch_offset?: number;
  success_count?: number;
  target_type?: string;
  segment_conditions?: string | null;
  sent_at?: string | null;
  dedup_progress?: string | null;
  // 'stale' → locked long ago (recoverable); 'fresh' → just locked (not yet stale)
  lock?: 'stale' | 'fresh' | null;
}

function insertBroadcast(sqlite: Database.Database, o: BcastOverrides) {
  const lock =
    o.lock === 'stale'
      ? "'2020-01-01T00:00:00.000'"
      : o.lock === 'fresh'
        ? "strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')"
        : 'NULL';
  sqlite
    .prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, status,
          success_count, batch_offset, segment_conditions, dedup_progress, sent_at, batch_lock_at)
       VALUES (?, 'T', 'text', 'hi', ?, ?, ?, ?, ?, ?, ?, ${lock})`,
    )
    .run(
      o.id,
      o.target_type ?? 'tag',
      o.status ?? 'sending',
      o.success_count ?? 0,
      o.batch_offset ?? -1,
      o.segment_conditions === undefined ? TAG_MARKER : o.segment_conditions,
      o.dedup_progress ?? null,
      o.sent_at ?? null,
    );
}

function row(sqlite: Database.Database, id: string) {
  return sqlite
    .prepare('SELECT batch_offset, batch_lock_at FROM broadcasts WHERE id = ?')
    .get(id) as { batch_offset: number; batch_lock_at: string | null };
}

describe('recoverStalledBroadcasts — non-dedup stuck at batch_offset=-1 (#5)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupDb();
    db = asD1(sqlite);
  });

  test('resumes a stalled tag/segment broadcast at success_count (not 0), unlocking it', async () => {
    // 6/10 batches sent then the isolate died mid-loop: offset stayed -1, success_count=3000.
    insertBroadcast(sqlite, { id: 'b1', success_count: 3000, batch_offset: -1, lock: 'stale' });

    await recoverStalledBroadcasts(db);

    const r = row(sqlite, 'b1');
    // Resumes from the already-sent count so the sent prefix is not re-delivered.
    expect(r.batch_offset).toBe(3000);
    expect(r.batch_lock_at).toBeNull();

    // And it is now visible to the queue processor again.
    const queued = await getQueuedBroadcasts(db);
    expect(queued.map((b) => b.id)).toContain('b1');
  });

  test('does NOT recover a freshly-locked row (worker may still be running)', async () => {
    insertBroadcast(sqlite, { id: 'b2', success_count: 3000, batch_offset: -1, lock: 'fresh' });
    await recoverStalledBroadcasts(db);
    expect(row(sqlite, 'b2').batch_offset).toBe(-1);
  });

  test('leaves the untouched-progress branch (success_count=0) resetting to 0', async () => {
    insertBroadcast(sqlite, { id: 'b3', success_count: 0, batch_offset: -1, lock: 'stale' });
    await recoverStalledBroadcasts(db);
    // Branch 1 (no progress) resets to 0, not to success_count.
    expect(row(sqlite, 'b3').batch_offset).toBe(0);
  });

  test('does not touch a completed broadcast (sent_at set)', async () => {
    insertBroadcast(sqlite, {
      id: 'b4',
      success_count: 3000,
      batch_offset: -1,
      lock: 'stale',
      sent_at: '2026-01-01T00:00:00.000',
    });
    await recoverStalledBroadcasts(db);
    expect(row(sqlite, 'b4').batch_offset).toBe(-1);
  });
});
