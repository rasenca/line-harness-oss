import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// Mock the DB + LINE SDK so we can observe whether the handler did ANY work
// (friend lookup / push / metadata write) for a given auth outcome.
const dbMocks = {
  getFriendByLineUserId: vi.fn(),
  getLineAccountById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const pushMessage = vi.fn();
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage })),
}));

const { meetCallback } = await import('./meet-callback.js');

let dbWrites = 0;
const DB = {
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      run: vi.fn(async () => {
        dbWrites += 1;
        return {};
      }),
    })),
  })),
} as unknown as D1Database;

const SECRET = 'meet-shared-secret';

function app() {
  const a = new Hono<Env>();
  a.route('/', meetCallback);
  return a;
}

function envWith(secret?: string) {
  return { DB, LINE_CHANNEL_ACCESS_TOKEN: 'tok', MEET_HARNESS_SECRET: secret } as unknown as Env['Bindings'];
}

const validBody = {
  session_id: 's1',
  scenario_id: 'sc1',
  line_user_id: 'U-victim',
  status: 'done',
  transcripts: [{ question_text: 'Q', transcript: 'hi' }],
  completed_at: '2026-07-23T12:00:00.000+09:00',
};

function post(secretHeader: string | null, env: Env['Bindings']) {
  return app().request(
    '/api/meet-callback',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secretHeader === null ? {} : { 'X-LINE-HARNESS-LINK-SECRET': secretHeader }),
      },
      body: JSON.stringify(validBody),
    },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbWrites = 0;
  dbMocks.getFriendByLineUserId.mockResolvedValue({
    id: 'friend-1',
    line_user_id: 'U-victim',
    display_name: 'Victim',
    metadata: '{}',
  });
  pushMessage.mockResolvedValue(undefined);
});

describe('POST /api/meet-callback shared-secret auth (#9/#11)', () => {
  test('fails closed with 503 when MEET_HARNESS_SECRET is not configured', async () => {
    const res = await post(SECRET, envWith(undefined));
    expect(res.status).toBe(503);
    // No side effects: no friend lookup, no push, no metadata write.
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
    expect(dbWrites).toBe(0);
  });

  test('rejects with 401 when the shared-secret header is missing', async () => {
    const res = await post(null, envWith(SECRET));
    expect(res.status).toBe(401);
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
    expect(dbWrites).toBe(0);
  });

  test('rejects with 401 when the shared secret does not match', async () => {
    const res = await post('wrong-secret', envWith(SECRET));
    expect(res.status).toBe(401);
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
    expect(dbWrites).toBe(0);
  });

  test('accepts and processes the callback with the correct shared secret', async () => {
    const res = await post(SECRET, envWith(SECRET));
    expect(res.status).toBe(200);
    expect(dbMocks.getFriendByLineUserId).toHaveBeenCalledWith(DB, 'U-victim');
    expect(pushMessage).toHaveBeenCalledTimes(1);
    expect(dbWrites).toBe(1);
  });
});
