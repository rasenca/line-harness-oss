import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { LineClient } from '@line-crm/line-sdk';

// Mock the DB layer + stealth so we can drive processReminderDeliveries in
// isolation and observe whether it claimed / sent / released a step (#20).
const dbMocks = {
  getDueReminderDeliveries: vi.fn(),
  getFriendById: vi.fn(),
  completeReminderIfDone: vi.fn(async () => {}),
  getLineAccountById: vi.fn(),
  jstNow: () => '2026-07-24T12:00:00.000+09:00',
};
vi.mock('@line-crm/db', () => dbMocks);
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }));
vi.mock('./stealth.js', () => ({ addJitter: () => 0, sleep: async () => {} }));

const { processReminderDeliveries } = await import('./reminder-delivery.js');

// Records every prepared statement so tests can assert on claim / release / log
// ordering. The INSERT OR IGNORE claim returns meta.changes = `claimChanges`,
// simulating "won the claim" (1) vs "a concurrent invocation already claimed" (0).
function makeDb(claimChanges: number) {
  const ops: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              ops.push({ sql, args });
              if (sql.includes('INSERT OR IGNORE INTO friend_reminder_deliveries')) {
                return { meta: { changes: claimChanges } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, ops };
}

const has = (ops: Array<{ sql: string }>, needle: string) => ops.some((o) => o.sql.includes(needle));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_user_id: 'U1', is_following: 1 });
  dbMocks.getDueReminderDeliveries.mockResolvedValue([
    {
      id: 'fr-1',
      reminder_id: 'r-1',
      friend_id: 'friend-1',
      steps: [{ id: 'step-1', message_type: 'text', message_content: 'hi' }],
    },
  ]);
});

describe('processReminderDeliveries claim-before-send (#20)', () => {
  test('sends and logs when it wins the atomic claim', async () => {
    const pushMessage = vi.fn();
    const { db, ops } = makeDb(1);
    await processReminderDeliveries(db, { pushMessage } as unknown as LineClient);

    expect(pushMessage).toHaveBeenCalledTimes(1);
    expect(has(ops, 'INSERT OR IGNORE INTO friend_reminder_deliveries')).toBe(true);
    expect(has(ops, 'INSERT INTO messages_log')).toBe(true);
    // No release on the happy path.
    expect(has(ops, 'DELETE FROM friend_reminder_deliveries')).toBe(false);
  });

  test('does NOT send when a concurrent invocation already claimed the step', async () => {
    const pushMessage = vi.fn();
    const { db, ops } = makeDb(0);
    await processReminderDeliveries(db, { pushMessage } as unknown as LineClient);

    // Losing the claim (changes === 0) must skip the send AND the log — this is
    // the dedup that stops the overlapping */5 + 0 */6 crons double-sending.
    expect(pushMessage).not.toHaveBeenCalled();
    expect(has(ops, 'INSERT INTO messages_log')).toBe(false);
    expect(has(ops, 'DELETE FROM friend_reminder_deliveries')).toBe(false);
  });

  test('releases the claim when the push fails so a later tick can retry', async () => {
    const pushMessage = vi.fn(async () => {
      throw new Error('LINE 500');
    });
    const { db, ops } = makeDb(1);
    // Outer catch swallows the error; the function still resolves.
    await processReminderDeliveries(db, { pushMessage } as unknown as LineClient);

    expect(pushMessage).toHaveBeenCalledTimes(1);
    expect(has(ops, 'DELETE FROM friend_reminder_deliveries')).toBe(true);
    // Send failed, so nothing should be logged as delivered.
    expect(has(ops, 'INSERT INTO messages_log')).toBe(false);
  });
});
