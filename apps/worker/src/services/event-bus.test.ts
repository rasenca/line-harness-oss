import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent } from './event-bus.js';

interface CapturedInsert {
  sql: string;
  binds: unknown[];
}

function fakeDb(opts: {
  friend?: { line_user_id: string };
  capturedInserts: CapturedInsert[];
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          if (sql.includes('INSERT INTO messages_log')) {
            opts.capturedInserts.push({ sql, binds: args });
          }
          return this;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM friends WHERE id')) {
            return (opts.friend ?? null) as T | null;
          }
          return null;
        },
        async run(): Promise<{ success: true }> {
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@line-crm/db');
  return {
    ...actual,
    getActiveOutgoingWebhooksByEvent: vi.fn().mockResolvedValue([]),
    applyScoring: vi.fn().mockResolvedValue(undefined),
    getActiveAutomationsByEvent: vi.fn(),
    createAutomationLog: vi.fn().mockResolvedValue(undefined),
    getActiveNotificationRulesByEvent: vi.fn().mockResolvedValue([]),
    createNotification: vi.fn().mockResolvedValue(undefined),
    addTagToFriend: vi.fn().mockResolvedValue(undefined),
    removeTagFromFriend: vi.fn().mockResolvedValue(undefined),
    enrollFriendInScenario: vi.fn().mockResolvedValue(undefined),
    jstNow: () => '2026-05-08T00:00:00.000+09:00',
    getFriendScore: vi.fn().mockResolvedValue(0),
    getTemplateById: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('@line-crm/line-sdk', () => {
  return {
    LineClient: vi.fn().mockImplementation(() => ({
      replyMessage: vi.fn().mockResolvedValue(undefined),
      pushMessage: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('./ad-conversion.js', () => ({
  sendAdConversions: vi.fn().mockResolvedValue(undefined),
}));

describe('fireEvent — send_message action logging', () => {
  let captured: CapturedInsert[];

  beforeEach(async () => {
    captured = [];
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-1',
        line_account_id: 'acc-1',
        conditions: JSON.stringify({ keyword: 'コスト比較' }),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: {
              messageType: 'flex',
              content: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"hi"}]}}',
              altText: 'hi',
            },
          },
        ]),
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs flex outgoing message to messages_log when send_message fires via reply', async () => {
    const db = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      db,
      'message_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'コスト比較', matched: true },
        replyToken: 'reply-token-xyz',
      },
      'channel-token',
      'acc-1',
    );

    expect(captured).toHaveLength(1);
    const insert = captured[0];
    expect(insert.sql).toContain('INSERT INTO messages_log');
    // bind order: id, friendId, messageType, content, deliveryType, source, lineAccountId, createdAt
    expect(insert.binds[1]).toBe('friend-1');
    expect(insert.binds[2]).toBe('flex');
    expect(insert.binds[4]).toBe('reply');
    expect(insert.binds[5]).toBe('automation');
    expect(insert.binds[6]).toBe('acc-1');
  });

  it('logs delivery_type=push when no replyToken provided', async () => {
    const db = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      db,
      'message_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'コスト比較', matched: true },
      },
      'channel-token',
      'acc-1',
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].binds[4]).toBe('push');
  });

  it('logs even when text message (not flex) is sent', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-2',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: { messageType: 'text', content: 'hello' },
          },
        ]),
      },
    ]);

    const dbFake = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      dbFake,
      'tag_added',
      { friendId: 'friend-1', eventData: {} },
      'channel-token',
      null,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].binds[2]).toBe('text');
    expect(captured[0].binds[3]).toBe('hello');
    expect(captured[0].binds[6]).toBe(null);
  });

  // #6: tag_change / cv_fire callers pass NO lineAccessToken. Previously
  // send_message silently `break`ed yet was logged as success. Now the token is
  // resolved from the friend's account, or the action fails loudly.
  function tokenlessDb(opts: {
    friend?: { line_user_id: string };
    accountToken?: string | null;
    capturedInserts: CapturedInsert[];
  }): D1Database {
    return {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            if (sql.includes('INSERT INTO messages_log')) {
              opts.capturedInserts.push({ sql, binds: args });
            }
            return this;
          },
          async all<T>(): Promise<{ results: T[] }> {
            return { results: [] };
          },
          async first<T>(): Promise<T | null> {
            if (sql.includes('channel_access_token')) {
              return (opts.accountToken === undefined
                ? null
                : { token: opts.accountToken }) as T | null;
            }
            if (sql.includes('FROM friends WHERE id')) {
              return (opts.friend ?? null) as T | null;
            }
            return null;
          },
          async run(): Promise<{ success: true }> {
            return { success: true };
          },
        };
      },
    } as unknown as D1Database;
  }

  it('resolves the account token and sends when the caller passes none', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-tagfire',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([{ type: 'send_message', params: { messageType: 'text', content: 'hi' } }]),
      },
    ]);

    const dbFake = tokenlessDb({
      friend: { line_user_id: 'U_test' },
      accountToken: 'resolved-account-token',
      capturedInserts: captured,
    });
    // No token passed (mirrors friends.ts / stripe.ts tag_change/cv_fire callers).
    await fireEvent(dbFake, 'tag_change', { friendId: 'friend-1', eventData: { action: 'add' } });

    // The message was actually sent + logged (not a silent no-op).
    expect(captured).toHaveLength(1);
    expect(captured[0].binds[3]).toBe('hi');
    // And the automation was logged as success.
    expect(db.createAutomationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('logs FAILED (not success) when no token can be resolved', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-notoken',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([{ type: 'send_message', params: { messageType: 'text', content: 'hi' } }]),
      },
    ]);

    const dbFake = tokenlessDb({
      friend: { line_user_id: 'U_test' },
      accountToken: null, // friend has no resolvable account token
      capturedInserts: captured,
    });
    await fireEvent(dbFake, 'tag_change', { friendId: 'friend-1', eventData: { action: 'add' } });

    // No message sent, and the automation is recorded as failed — NOT success.
    expect(captured).toHaveLength(0);
    expect(db.createAutomationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
    );
  });

  // #7: tag_change carries eventData.action = 'add' | 'remove'. matchConditions
  // must distinguish them so a removal does not trigger add-oriented automations.
  async function setTagChangeAutomation(conditionAction?: string) {
    const db = await import('@line-crm/db');
    const conditions: Record<string, unknown> = { tag_id: 'trial' };
    if (conditionAction !== undefined) conditions.action = conditionAction;
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-tag',
        line_account_id: null,
        conditions: JSON.stringify(conditions),
        actions: JSON.stringify([{ type: 'add_tag', params: { tagId: 'welcomed' } }]),
      },
    ]);
    return db;
  }

  async function fireTagChange(action: 'add' | 'remove') {
    const dbFake = fakeDb({ friend: { line_user_id: 'U_test' }, capturedInserts: captured });
    await fireEvent(dbFake, 'tag_change', { friendId: 'friend-1', eventData: { tagId: 'trial', action } });
  }

  it('fires on add for a tag_change automation with no explicit action (add-only default)', async () => {
    const db = await setTagChangeAutomation();
    await fireTagChange('add');
    expect(db.createAutomationLog).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on remove for an add-oriented (default) tag_change automation', async () => {
    const db = await setTagChangeAutomation();
    await fireTagChange('remove');
    expect(db.createAutomationLog).not.toHaveBeenCalled();
  });

  it('fires on remove when the automation opts in with action=remove', async () => {
    const db = await setTagChangeAutomation('remove');
    await fireTagChange('remove');
    expect(db.createAutomationLog).toHaveBeenCalledTimes(1);
    // ...and does not fire on add for a remove-only automation.
    vi.clearAllMocks();
    const db2 = await setTagChangeAutomation('remove');
    await fireTagChange('add');
    expect(db2.createAutomationLog).not.toHaveBeenCalled();
  });

  it('fires on both when action=any', async () => {
    const db = await setTagChangeAutomation('any');
    await fireTagChange('add');
    await fireTagChange('remove');
    expect(db.createAutomationLog).toHaveBeenCalledTimes(2);
  });

  it('resolves params.template_id via templates table when set', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-tpl',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: {
              template_id: 'tpl-1',
              // content / messageType を空にして template 経由 resolve を強制
            },
          },
        ]),
      },
    ]);
    (db.getTemplateById as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'tpl-1',
      name: 'test-tpl',
      category: 'general',
      message_type: 'flex',
      message_content: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"from-template"}]}}',
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const dbFake = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      dbFake,
      'manual_test',
      { friendId: 'friend-1', eventData: {} },
      'channel-token',
      null,
    );

    expect(captured).toHaveLength(1);
    // log には template から取得した messageType / content が記録される
    expect(captured[0].binds[2]).toBe('flex');
    expect(String(captured[0].binds[3])).toContain('from-template');
  });
});
