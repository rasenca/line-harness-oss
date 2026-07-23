import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getFriendByLineUserId } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';

const app = new Hono<Env>();

// Constant-time comparison so a mismatching shared secret cannot be recovered
// via response timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Meet Harness calls this when a hearing session completes
app.post('/api/meet-callback', async (c) => {
  // This endpoint is on the auth allowlist (auth.ts) so an external service can
  // reach it, but it MUST self-authenticate: without a check any anonymous
  // caller who knows a line_user_id could push arbitrary Flex messages from the
  // tenant's official account and overwrite the friend's metadata (#9/#11).
  // Require a shared secret and FAIL CLOSED — if none is configured we refuse
  // rather than fall back to accepting unauthenticated callbacks.
  const configuredSecret = c.env.MEET_HARNESS_SECRET;
  if (!configuredSecret) {
    console.error('meet-callback rejected: MEET_HARNESS_SECRET is not configured');
    return c.json({ success: false, error: 'Meet callback is not configured' }, 503);
  }
  const presented = c.req.header('X-LINE-HARNESS-LINK-SECRET') ?? '';
  if (!timingSafeEqual(presented, configuredSecret)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    session_id: string;
    scenario_id: string;
    line_user_id: string;
    status: string;
    context?: Record<string, unknown>;
    transcripts: Array<{
      question_text?: string;
      transcript: string;
    }>;
    requirements_doc?: string;
    completed_at: string;
  }>();

  if (!body.line_user_id) {
    return c.json({ success: false, error: 'line_user_id required' }, 400);
  }

  const friend = await getFriendByLineUserId(c.env.DB, body.line_user_id);
  if (!friend) {
    return c.json({ success: false, error: 'friend not found' }, 404);
  }

  // Resolve LINE access token (multi-account support)
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if ((friend as unknown as Record<string, unknown>).line_account_id) {
    const { getLineAccountById } = await import('@line-crm/db');
    const account = await getLineAccountById(c.env.DB, (friend as unknown as Record<string, unknown>).line_account_id as string);
    if (account) accessToken = account.channel_access_token;
  }
  const lineClient = new LineClient(accessToken);

  // Build Flex message with requirements doc
  const transcriptRows = body.transcripts.map((t) => ({
    type: 'box' as const, layout: 'vertical' as const, margin: 'md' as const,
    contents: [
      { type: 'text' as const, text: t.question_text || 'Q', size: 'xxs' as const, color: '#64748b' },
      { type: 'text' as const, text: t.transcript, size: 'sm' as const, color: '#1e293b', wrap: true },
    ],
  }));

  const resultFlex = {
    type: 'bubble', size: 'giga',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: 'ヒアリング完了', size: 'lg', weight: 'bold', color: '#1e293b' },
        { type: 'text', text: `${friend.display_name || ''}さん`, size: 'xs', color: '#64748b', margin: 'sm' },
      ],
      paddingAll: '20px', backgroundColor: '#f0f9ff',
    },
    body: {
      type: 'box', layout: 'vertical',
      contents: [
        ...transcriptRows,
        { type: 'separator', margin: 'lg' },
        ...(body.requirements_doc ? [
          { type: 'text' as const, text: '要件定義書', size: 'sm' as const, weight: 'bold' as const, color: '#1e293b', margin: 'lg' as const },
          { type: 'text' as const, text: body.requirements_doc.slice(0, 1000), size: 'xs' as const, color: '#334155', wrap: true, margin: 'sm' as const },
        ] : []),
      ],
      paddingAll: '20px',
    },
  };

  try {
    await lineClient.pushMessage(friend.line_user_id, [
      { type: 'flex', altText: 'ヒアリング結果', contents: resultFlex },
    ]);
  } catch (e) {
    console.error('Failed to send meet callback message:', e);
  }

  // Save to friend metadata
  try {
    const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
    const updated = {
      ...existing,
      meet_hearing: {
        session_id: body.session_id,
        status: body.status,
        context: body.context,
        transcripts: body.transcripts,
        requirements_doc: body.requirements_doc,
        completed_at: body.completed_at,
      },
    };
    await c.env.DB.prepare('UPDATE friends SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(JSON.stringify(updated), friend.id)
      .run();
  } catch (e) {
    console.error('Failed to save meet hearing to metadata:', e);
  }

  return c.json({ success: true });
});

export { app as meetCallback };
