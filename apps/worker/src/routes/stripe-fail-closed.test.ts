import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// #41: with STRIPE_WEBHOOK_SECRET unset the webhook must fail closed outside
// localhost. DB is mocked so the accepted-path test can complete; the reject
// paths return before touching it.
vi.mock('@line-crm/db', () => ({
  getStripeEvents: vi.fn(),
  getStripeEventByStripeId: vi.fn(async () => null),
  createStripeEvent: vi.fn(async () => ({ id: 'evt-row' })),
  jstNow: () => '2026-07-24T00:00:00.000+09:00',
}));

const { stripe } = await import('./stripe.js');

const throwingDb = {
  prepare: () => {
    throw new Error('DB must not be touched on a rejected webhook');
  },
} as unknown as D1Database;

const benignDb = {
  prepare: () => ({
    bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }),
  }),
} as unknown as D1Database;

function post(url: string, env: Partial<Env['Bindings']>, body: unknown, headers: Record<string, string> = {}) {
  const app = new Hono<Env>();
  app.route('/', stripe);
  return app.request(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) },
    env as Env['Bindings'],
  );
}

const PROD = 'https://worker.example.com/api/integrations/stripe/webhook';
const LOCAL = 'http://localhost:8787/api/integrations/stripe/webhook';
const forgedPurchase = {
  id: 'evt_1',
  type: 'payment_intent.succeeded',
  data: { object: { metadata: { line_friend_id: 'f1', product_id: 'p' }, amount: 1000, currency: 'jpy' } },
};

describe('Stripe webhook fail-closed when secret is unset (#41)', () => {
  test('production + no secret → 503, no side effects', async () => {
    const res = await post(PROD, { DB: throwingDb }, forgedPurchase);
    expect(res.status).toBe(503);
  });

  test('secret set + invalid signature → 401, no side effects', async () => {
    const res = await post(
      PROD,
      { DB: throwingDb, STRIPE_WEBHOOK_SECRET: 'whsec_test' } as unknown as Partial<Env['Bindings']>,
      forgedPurchase,
      { 'Stripe-Signature': 't=1,v1=deadbeef' },
    );
    expect(res.status).toBe(401);
  });

  test('localhost + no secret → still accepted (explicit dev fallback)', async () => {
    const res = await post(LOCAL, { DB: benignDb }, { id: 'evt_2', type: 'ping', data: { object: {} } });
    expect(res.status).not.toBe(503);
    expect(res.status).toBe(200);
  });
});
