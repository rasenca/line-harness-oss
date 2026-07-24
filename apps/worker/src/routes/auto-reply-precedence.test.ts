import { describe, expect, test } from 'vitest';
import { orderAutoRepliesBySpecificity } from './webhook.js';

type Rule = { id: string; match_type: 'exact' | 'contains'; keyword: string; created_at: string };

// Emulates the first-win selection the webhook handler runs: pick the first
// ordered rule that matches the incoming text.
function firstMatch(rules: Rule[], text: string): Rule | undefined {
  return orderAutoRepliesBySpecificity(rules).find((r) =>
    r.match_type === 'exact' ? text === r.keyword : text.includes(r.keyword),
  );
}

describe('orderAutoRepliesBySpecificity (#23)', () => {
  test('a later exact rule wins over an earlier broad contains rule', () => {
    const rules: Rule[] = [
      { id: 'A', match_type: 'contains', keyword: '予約', created_at: '2026-01-01T00:00:00Z' },
      { id: 'B', match_type: 'exact', keyword: '予約キャンセル', created_at: '2026-02-01T00:00:00Z' },
    ];
    // '予約キャンセル' matches both, but exact B is more specific and must win.
    expect(firstMatch(rules, '予約キャンセル')?.id).toBe('B');
    // A plain '予約' only matches the contains rule.
    expect(firstMatch(rules, '予約')?.id).toBe('A');
  });

  test('among contains rules, the longer keyword wins', () => {
    const rules: Rule[] = [
      { id: 'short', match_type: 'contains', keyword: '予約', created_at: '2026-01-01T00:00:00Z' },
      { id: 'long', match_type: 'contains', keyword: '予約キャンセル', created_at: '2026-02-01T00:00:00Z' },
    ];
    expect(firstMatch(rules, '予約キャンセルします')?.id).toBe('long');
  });

  test('same specificity falls back to created_at ASC (stable, deterministic)', () => {
    const rules: Rule[] = [
      { id: 'newer', match_type: 'contains', keyword: 'あ', created_at: '2026-02-01T00:00:00Z' },
      { id: 'older', match_type: 'contains', keyword: 'い', created_at: '2026-01-01T00:00:00Z' },
    ];
    // Both single-char contains; the earlier-created rule wins.
    expect(orderAutoRepliesBySpecificity(rules)[0].id).toBe('older');
  });

  test('does not mutate the input array', () => {
    const rules: Rule[] = [
      { id: 'A', match_type: 'contains', keyword: '予約', created_at: '2026-01-01T00:00:00Z' },
      { id: 'B', match_type: 'exact', keyword: '予約', created_at: '2026-02-01T00:00:00Z' },
    ];
    const before = rules.map((r) => r.id);
    orderAutoRepliesBySpecificity(rules);
    expect(rules.map((r) => r.id)).toEqual(before);
  });
});
