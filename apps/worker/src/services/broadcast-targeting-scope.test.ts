import { describe, expect, test } from 'vitest';
import { buildSegmentQuery } from './segment-query.js';
import { getFriendsByTag } from '@line-crm/db';

// Fake D1 that records the prepared SQL + bindings so we can assert scoping.
function recordingDb() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return { all: async () => ({ results: [] }) };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe('buildSegmentQuery account-scope precedence (#4)', () => {
  test('OR clauses are parenthesized so an injected account filter binds to all of them', () => {
    const { sql } = buildSegmentQuery({
      operator: 'OR',
      rules: [
        { type: 'tag_exists', value: 'tag-x' },
        { type: 'ref_code', value: 'camp1' },
      ],
    } as Parameters<typeof buildSegmentQuery>[0]);

    // The combined predicate must be wrapped in parens.
    expect(sql).toMatch(/WHERE \(.*\bOR\b.*\)$/);

    // Callers prepend the account scope via this exact string replace. With the
    // parens, AND binds to the whole OR-group, not just the first clause.
    const scoped = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
    expect(scoped).toContain('WHERE f.line_account_id = ? AND (');
    // The account filter must NOT sit inside the OR group (which would let
    // later clauses match cross-account).
    expect(scoped).not.toMatch(/OR f\.line_account_id/);
  });

  test('AND operator is also parenthesized (harmless, keeps replace uniform)', () => {
    const { sql } = buildSegmentQuery({
      operator: 'AND',
      rules: [
        { type: 'tag_exists', value: 'tag-x' },
        { type: 'ref_code', value: 'camp1' },
      ],
    } as Parameters<typeof buildSegmentQuery>[0]);
    expect(sql).toMatch(/WHERE \(.*\bAND\b.*\)$/);
  });
});

describe('getFriendsByTag account scoping (#14)', () => {
  test('scopes to the sending account when an accountId is given', async () => {
    const { db, calls } = recordingDb();
    await getFriendsByTag(db, 'tag-1', 'acct-A');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('f.line_account_id = ?');
    expect(calls[0].args).toEqual(['tag-1', 'acct-A']);
  });

  test('falls back to tag-only when no accountId is given (single-account/legacy)', async () => {
    const { db, calls } = recordingDb();
    await getFriendsByTag(db, 'tag-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain('f.line_account_id');
    expect(calls[0].args).toEqual(['tag-1']);
  });

  test('treats an explicit null accountId as unscoped', async () => {
    const { db, calls } = recordingDb();
    await getFriendsByTag(db, 'tag-1', null);
    expect(calls[0].sql).not.toContain('f.line_account_id');
    expect(calls[0].args).toEqual(['tag-1']);
  });
});
