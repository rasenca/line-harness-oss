import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// #42: /api/liff/profile must require a verified LINE id_token and derive
// identity from the token, not from the request body. Mock the verifier so we
// don't hit LINE's network endpoint.
const verifyMock = vi.fn();
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineUserId: verifyMock }));

const { liffRoutes } = await import('./liff.js');

// Records bound args so we can prove the friend lookup uses the verified sub,
// never the attacker-supplied body.lineUserId.
function friendDb() {
  const binds: unknown[][] = [];
  const stmt = {
    first: async () => ({ id: 'friend-1', line_user_id: 'U-self', display_name: 'Self', is_following: 1, user_id: 'uuid-1' }),
    all: async () => ({ results: [] as unknown[] }),
    run: async () => ({ meta: { changes: 0 } }),
  };
  const db = {
    prepare: (_sql: string) => ({
      ...stmt,
      bind: (...args: unknown[]) => {
        binds.push(args);
        return stmt;
      },
    }),
  } as unknown as D1Database;
  return { db, binds };
}

function post(env: Partial<Env['Bindings']>, headers: Record<string, string>, body: unknown) {
  const app = new Hono<Env>();
  app.route('/', liffRoutes);
  return app.request(
    '/api/liff/profile',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) },
    env as Env['Bindings'],
  );
}

beforeEach(() => verifyMock.mockReset());

describe('POST /api/liff/profile requires a verified id_token (#42)', () => {
  test('unverified caller → 401 and no friend lookup (oracle closed)', async () => {
    verifyMock.mockResolvedValue(null);
    const { db, binds } = friendDb();
    const res = await post({ DB: db }, {}, { lineUserId: 'U-victim' });
    expect(res.status).toBe(401);
    expect(binds).toHaveLength(0); // never queried anyone
  });

  test('verified caller → own profile, keyed by the token sub not the body', async () => {
    verifyMock.mockResolvedValue('U-self');
    const { db, binds } = friendDb();
    const res = await post({ DB: db }, { Authorization: 'Bearer good' }, { lineUserId: 'U-victim' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe('friend-1');
    // Verifier saw the Authorization header; lookup used the verified sub.
    expect(verifyMock).toHaveBeenCalledWith('Bearer good', expect.anything());
    expect(binds.some((b) => b.includes('U-self'))).toBe(true);
    expect(binds.some((b) => b.includes('U-victim'))).toBe(false);
  });
});
