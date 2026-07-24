import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { conversations } from './conversations.js';
import { friends } from './friends.js';

// Records every prepared statement's SQL + bound args so we can assert what the
// clamped pagination params actually bind into LIMIT/OFFSET (#18/#19). Returns
// empty result sets so the handlers short-circuit downstream work (no tag
// lookup, no chat-status hydration).
function recordingDb() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const stmt = {
    all: async () => ({ results: [] as unknown[] }),
    first: async () => ({ count: 0, total: 0 }),
  };
  const db = {
    prepare(sql: string) {
      return {
        ...stmt,
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return stmt;
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

const lastTwo = (args: unknown[]) => args.slice(-2);

async function requestConversations(query: string) {
  const { db, calls } = recordingDb();
  const app = new Hono<Env>();
  app.route('/', conversations);
  const res = await app.request(`/api/conversations${query}`, {}, { DB: db } as unknown as Env['Bindings']);
  return { res, calls };
}

async function requestFriends(query: string) {
  const { db, calls } = recordingDb();
  const app = new Hono<Env>();
  app.route('/', friends);
  const res = await app.request(`/api/friends${query}`, {}, { DB: db } as unknown as Env['Bindings']);
  return { res, calls };
}

// The main list query is the one carrying LIMIT ? OFFSET ?.
const listCall = (calls: Array<{ sql: string; args: unknown[] }>) =>
  calls.find((c) => c.sql.includes('LIMIT ? OFFSET ?'));

describe('GET /api/conversations pagination clamp (#19)', () => {
  test('negative limit clamps to 1 (not an unlimited SQLite scan)', async () => {
    const { res, calls } = await requestConversations('?limit=-1');
    expect(res.status).toBe(200);
    // bindings = [minHoursSince, limit, offset]
    expect(lastTwo(listCall(calls)!.args)).toEqual([1, 0]);
  });

  test('non-numeric limit falls back to 50, not NaN', async () => {
    const { calls } = await requestConversations('?limit=abc');
    expect(lastTwo(listCall(calls)!.args)).toEqual([50, 0]);
  });

  test('over-max limit clamps to 200', async () => {
    const { calls } = await requestConversations('?limit=500');
    expect(lastTwo(listCall(calls)!.args)).toEqual([200, 0]);
  });

  test('non-numeric minHoursSince binds 0, not NaN (no 500)', async () => {
    const { res, calls } = await requestConversations('?minHoursSince=abc');
    expect(res.status).toBe(200);
    // minHoursSince is the FIRST binding of the main query.
    expect(listCall(calls)!.args[0]).toBe(0);
  });

  test('negative offset clamps to 0', async () => {
    const { calls } = await requestConversations('?offset=-5');
    expect(lastTwo(listCall(calls)!.args)).toEqual([50, 0]);
  });
});

describe('GET /api/friends pagination clamp (#18)', () => {
  test('negative limit clamps to 1', async () => {
    const { res, calls } = await requestFriends('?includeTags=false&limit=-1');
    expect(res.status).toBe(200);
    expect(lastTwo(listCall(calls)!.args)).toEqual([1, 0]);
  });

  test('non-numeric limit falls back to 50', async () => {
    const { calls } = await requestFriends('?includeTags=false&limit=abc');
    expect(lastTwo(listCall(calls)!.args)).toEqual([50, 0]);
  });

  test('over-max limit clamps to 200', async () => {
    const { calls } = await requestFriends('?includeTags=false&limit=500');
    expect(lastTwo(listCall(calls)!.args)).toEqual([200, 0]);
  });

  test('negative offset clamps to 0', async () => {
    const { calls } = await requestFriends('?includeTags=false&offset=-3');
    expect(lastTwo(listCall(calls)!.args)).toEqual([50, 0]);
  });
});
