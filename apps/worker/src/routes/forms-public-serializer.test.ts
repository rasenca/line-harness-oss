import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

// Mock every @line-crm/db symbol imported by forms.ts (and by liff-auth.ts).
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

const { forms } = await import('./forms.js');

const DB = {} as unknown as D1Database;
const env = { DB } as unknown as Env['Bindings'];

function app() {
  const a = new Hono<Env>();
  a.route('/', forms);
  return a;
}

// A form row configured with a webhook whose URL is the engagement-gate verify
// endpoint AND whose headers carry a downstream credential — exactly the shape
// the reported disclosure (#12/#15) leaks and the redirect (#17) exfiltrates.
const GATED_FORM = {
  id: 'form-1',
  name: 'Reward form',
  description: 'desc',
  fields: JSON.stringify([{ name: 'x_username', label: 'X ID', type: 'text' }]),
  on_submit_tag_id: 'tag-secret',
  on_submit_scenario_id: 'scenario-secret',
  on_submit_message_type: 'text',
  on_submit_message_content: '特典です',
  on_submit_webhook_url: 'https://xh.example/api/engagement-gates/g1/verify',
  on_submit_webhook_headers: JSON.stringify({ Authorization: 'Bearer sk_live_SECRET' }),
  on_submit_webhook_fail_message: '条件未達',
  save_to_metadata: 0,
  is_active: 1,
  submit_count: 0,
  og_title: null,
  og_description: null,
  og_image_url: null,
  created_at: '2026-07-23T00:00:00.000+09:00',
  updated_at: '2026-07-23T00:00:00.000+09:00',
};

let outbound: { url: string; headers: Record<string, string> } | null = null;
function stubXHarness(body: unknown, status = 200) {
  outbound = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      outbound = { url, headers: (init?.headers ?? {}) as Record<string, string> };
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  outbound = null;
});

describe('GET /api/forms/:id public serializer (#12/#15)', () => {
  test('omits webhook credentials and internal automation config', async () => {
    dbMocks.getFormById.mockResolvedValue(GATED_FORM);
    const res = await app().request('/api/forms/form-1', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(json.success).toBe(true);

    // Secrets / internal config must NOT be present on the public response.
    expect(json.data).not.toHaveProperty('onSubmitWebhookUrl');
    expect(json.data).not.toHaveProperty('onSubmitWebhookHeaders');
    expect(json.data).not.toHaveProperty('onSubmitTagId');
    expect(json.data).not.toHaveProperty('onSubmitScenarioId');
    expect(json.data).not.toHaveProperty('onSubmitMessageType');
    // No value anywhere in the payload should reveal the stored credential.
    expect(JSON.stringify(json.data)).not.toContain('sk_live_SECRET');
    expect(JSON.stringify(json.data)).not.toContain('xh.example');

    // What the LIFF renderer legitimately needs IS present.
    expect(json.data.id).toBe('form-1');
    expect(json.data.name).toBe('Reward form');
    expect(json.data.hasEngagementGate).toBe(true);
    expect(Array.isArray(json.data.fields)).toBe(true);
  });

  test('hasEngagementGate is false when no webhook is configured', async () => {
    dbMocks.getFormById.mockResolvedValue({ ...GATED_FORM, on_submit_webhook_url: null });
    const res = await app().request('/api/forms/form-1', {}, env);
    const json = (await res.json()) as { data: { hasEngagementGate: boolean } };
    expect(json.data.hasEngagementGate).toBe(false);
  });
});

describe('X engagement-gate proxy resolves target server-side (#17)', () => {
  test('x-repliers sends stored credentials to the stored host, ignoring client ?xh', async () => {
    dbMocks.getFormById.mockResolvedValue(GATED_FORM);
    stubXHarness({ success: true, data: [{ username: 'alice' }] });

    // Attacker-supplied ?xh / ?gate must be ignored.
    const res = await app().request(
      '/api/forms/form-1/x-repliers?xh=https://evil.example&gate=attacker',
      {},
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; data: unknown[] };
    expect(json.data).toEqual([{ username: 'alice' }]);

    // Outbound call went to the SERVER-STORED host + gate, never the client's.
    expect(outbound).not.toBeNull();
    expect(outbound!.url).toBe('https://xh.example/api/engagement-gates/g1/repliers');
    expect(outbound!.url).not.toContain('evil.example');
    expect(outbound!.url).not.toContain('attacker');
    // The credential travelled server→X-Harness, never to the browser.
    expect(outbound!.headers.Authorization).toBe('Bearer sk_live_SECRET');
  });

  test('x-repliers degrades to an empty pool when no gate is configured (no outbound call)', async () => {
    dbMocks.getFormById.mockResolvedValue({ ...GATED_FORM, on_submit_webhook_url: null });
    stubXHarness({ success: true, data: [{ username: 'alice' }] });
    const res = await app().request('/api/forms/form-1/x-repliers', {}, env);
    const json = (await res.json()) as { success: boolean; data: unknown[] };
    expect(json.data).toEqual([]);
    expect(outbound).toBeNull();
  });

  test('x-verify proxies to the stored verify endpoint with the stored credentials', async () => {
    dbMocks.getFormById.mockResolvedValue(GATED_FORM);
    stubXHarness({ success: true, data: { eligible: true } });

    const res = await app().request(
      '/api/forms/form-1/x-verify?username=@bob&xh=https://evil.example',
      {},
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { eligible: boolean } };
    expect(json.data.eligible).toBe(true);
    expect(outbound!.url).toBe('https://xh.example/api/engagement-gates/g1/verify?username=bob');
    expect(outbound!.url).not.toContain('evil.example');
    expect(outbound!.headers.Authorization).toBe('Bearer sk_live_SECRET');
  });

  test('x-verify requires a username', async () => {
    dbMocks.getFormById.mockResolvedValue(GATED_FORM);
    stubXHarness({ success: true, data: {} });
    const res = await app().request('/api/forms/form-1/x-verify', {}, env);
    expect(res.status).toBe(400);
    expect(outbound).toBeNull();
  });
});
