/**
 * HTML-escape a string for safe interpolation into HTML text OR quoted
 * attribute values.
 *
 * The LIFF client renderers interpolate values into double-quoted attributes
 * (e.g. `placeholder="${escapeHtml(x)}"`, `<img src="${escapeHtml(url)}">`), so
 * quotes MUST be escaped — otherwise a value containing `"` breaks out of the
 * attribute and injects an event handler (attribute-breakout XSS). The previous
 * `document.createElement('div')` + textContent→innerHTML approach only escaped
 * `& < >` (text-node semantics) and left `"`/`'` intact.
 *
 * Escaping all five is safe in text context too (browsers decode the entities),
 * and this pure implementation also works outside a DOM (Workers / tests).
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
