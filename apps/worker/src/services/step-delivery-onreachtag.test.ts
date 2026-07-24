import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LineClient } from '@line-crm/line-sdk';

// #24: a scenario step's on_reach tag must go through the shared side-effect
// helper (tag_change + tag_added enrollment), not a bare addTagToFriend. Mock
// the helper so we can assert the wiring without exercising its full fan-out
// (which is covered where the helper itself lives).
const attachMock = vi.fn(async () => ({ added: true }));
vi.mock('./friend-tag-attach.js', () => ({ attachTagAndFireSideEffects: attachMock }));

const { processStepDeliveries } = await import('./step-delivery.js');

// Fake D1 that surfaces one due friend_scenario whose next step (order 1) has
// no gating condition and an on_reach_tag_id, so it is delivered and tagged.
function mockDb(onReachTagId: string | null) {
  const stepRows = [
    {
      id: 'step-1',
      scenario_id: 'sc1',
      step_order: 1,
      message_type: 'text',
      message_content: 'hello',
      template_id: null,
      delay_minutes: 10,
      offset_days: null,
      offset_minutes: null,
      delivery_time: null,
      condition_type: null,
      condition_value: null,
      next_step_on_false: null,
      on_reach_tag_id: onReachTagId,
    },
  ];
  const db = {
    prepare: (sql: string) => {
      const stmt = () => ({
        first: async () => {
          if (sql.includes('delivery_mode FROM scenarios')) return { delivery_mode: 'relative' };
          if (sql.includes('FROM friends')) {
            return {
              id: 'f1',
              line_user_id: 'U1',
              display_name: 'Test',
              is_following: 1,
              user_id: null,
              metadata: null,
              line_account_id: null,
            };
          }
          return null;
        },
        all: async () => {
          if (sql.includes('FROM friend_scenarios')) {
            return {
              results: [
                {
                  id: 'fs1',
                  friend_id: 'f1',
                  scenario_id: 'sc1',
                  current_step_order: 0,
                  status: 'active',
                  next_delivery_at: '2026-01-01T00:00:00+09:00',
                  started_at: '2026-01-01T00:00:00+09:00',
                },
              ],
            };
          }
          if (sql.includes('FROM scenario_steps')) return { results: stepRows };
          return { results: [] };
        },
        run: async () => ({ meta: { changes: 1 } }),
      });
      return { bind: () => stmt(), ...stmt() };
    },
  } as unknown as D1Database;
  return db;
}

describe('scenario on_reach tag routes through side-effect helper (#24)', () => {
  beforeEach(() => attachMock.mockClear());

  it('fires attachTagAndFireSideEffects for a delivered step with on_reach_tag_id', async () => {
    const push = vi.fn(async () => ({}));
    await processStepDeliveries(mockDb('tag-reach'), { pushMessage: push } as unknown as LineClient);

    expect(push).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledWith(expect.anything(), 'f1', 'tag-reach');
  });

  it('does not tag when the step has no on_reach_tag_id', async () => {
    const push = vi.fn(async () => ({}));
    await processStepDeliveries(mockDb(null), { pushMessage: push } as unknown as LineClient);

    expect(push).toHaveBeenCalledTimes(1);
    expect(attachMock).not.toHaveBeenCalled();
  });
});
