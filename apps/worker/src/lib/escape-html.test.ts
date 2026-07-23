import { describe, expect, test } from 'vitest';
import { escapeHtml } from './escape-html.js';

describe('escapeHtml', () => {
  test('escapes all five HTML-significant characters (incl. quotes)', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('& is escaped first so entities are not double-encoded', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"')).toBe('&quot;'); // not &amp;quot;
  });

  test('neutralizes an attribute-breakout payload (double-quote is escaped)', () => {
    const payload = `x" autofocus onfocus="alert(1)`;
    const escaped = escapeHtml(payload);
    // The value can no longer close a double-quoted attribute.
    expect(escaped).not.toContain('"');
    expect(escaped).toContain('&quot;');
    // Interpolated into an attribute, no raw quote survives to break out.
    const html = `<input placeholder="${escaped}">`;
    expect(html).toBe('<input placeholder="x&quot; autofocus onfocus=&quot;alert(1)">');
  });

  test('leaves ordinary text unchanged', () => {
    expect(escapeHtml('山田 太郎 (VIP)')).toBe('山田 太郎 (VIP)');
  });
});
