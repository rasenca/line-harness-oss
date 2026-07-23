import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// Mock every @line-crm/db symbol imported by forms.ts (module load) and by
// liff-auth.ts (getLineAccounts). Only the ones this suite exercises carry
// meaningful implementations.
const dbMocks = {
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: vi.fn(),
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  createFormSubmission: vi.fn(),
  jstNow: vi.fn(() => '2026-07-23T12:00:00.000+09:00'),
  getFriendByLineUserId: vi.fn(),
  getFriendById: vi.fn(),
  addTagToFriend: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
};
vi.mock('@line-crm/db', () => dbMocks);

// Import after the mock is registered.
const { forms } = await import('./forms.js');

// Captures the last friends UPDATE so we can assert WHICH friend was written.
let lastUpdate: { sql: string; args: unknown[] } | null = null;
const DB = {
  prepare: vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => {
      lastUpdate = { sql, args };
      return { run: vi.fn(async () => ({})) };
    }),
  })),
} as unknown as D1Database;

const env = {
  DB,
  LINE_LOGIN_CHANNEL_ID: '2000000000',
} as unknown as Env['Bindings'];

function app() {
  const a = new Hono<Env>();
  a.route('/', forms);
  return a;
}

function installVerifyFetch(sub: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.line.me/oauth2/v2.1/verify') {
        return sub
          ? new Response(JSON.stringify({ sub }), { status: 200 })
          : new Response('bad token', { status: 400 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

beforeEach(() => {
  lastUpdate = null;
  vi.clearAllMocks();
  dbMocks.jstNow.mockReturnValue('2026-07-23T12:00:00.000+09:00');
  dbMocks.getLineAccounts.mockResolvedValue([]);
});

describe('POST /api/forms/:id/partial identity verification', () => {
  test('rejects with 401 when no LINE id_token is presented (no anonymous metadata write)', async () => {
    installVerifyFetch(null);
    const res = await app().request('/api/forms/form-1/partial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: 'victim-friend', data: { score: '999' } }),
    }, env);

    expect(res.status).toBe(401);
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(lastUpdate).toBeNull(); // nothing written
  });

  test('binds the metadata write to the VERIFIED caller, ignoring a spoofed body friendId', async () => {
    installVerifyFetch('U-verified');
    dbMocks.getFriendByLineUserId.mockResolvedValue({
      id: 'friend-verified',
      metadata: JSON.stringify({ existing: 'keep' }),
    });

    const res = await app().request('/api/forms/form-1/partial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-id-token',
      },
      // Attacker-style body naming a different friend — must be ignored.
      body: JSON.stringify({ friendId: 'victim-friend', lineUserId: 'U-victim', data: { score: '999' } }),
    }, env);

    expect(res.status).toBe(200);
    // Friend was resolved from the verified token, not the body.
    expect(dbMocks.getFriendByLineUserId).toHaveBeenCalledWith(DB, 'U-verified');
    expect(dbMocks.getFriendById).not.toHaveBeenCalled();
    // The UPDATE targets the verified friend id and merges (not clobbers) metadata.
    expect(lastUpdate).not.toBeNull();
    expect(lastUpdate!.args[lastUpdate!.args.length - 1]).toBe('friend-verified');
    const writtenMeta = JSON.parse(lastUpdate!.args[0] as string);
    expect(writtenMeta).toMatchObject({ existing: 'keep', score: '999' });
  });

  test('returns 404 when the verified caller is not a known friend', async () => {
    installVerifyFetch('U-unknown');
    dbMocks.getFriendByLineUserId.mockResolvedValue(null);

    const res = await app().request('/api/forms/form-1/partial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-id-token',
      },
      body: JSON.stringify({ data: { score: '1' } }),
    }, env);

    expect(res.status).toBe(404);
    expect(lastUpdate).toBeNull();
  });
});
