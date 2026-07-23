import { Hono } from 'hono';
import {
  getForms,
  getFormsWithStats,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  getFormSubmissions,
  createFormSubmission,
  jstNow,
} from '@line-crm/db';
import { getFriendByLineUserId, getFriendById } from '@line-crm/db';
import { enrollFriendInScenario } from '@line-crm/db';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import type {
  Form as DbForm,
  FormSubmission as DbFormSubmission,
  FormUsedByAccount,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { verifyCallerLineUserId } from '../services/liff-auth.js';

const forms = new Hono<Env>();

function serializeForm(
  row: DbForm,
  extra?: { lastSubmittedAt?: string | null; usedByAccounts?: FormUsedByAccount[] },
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    onSubmitTagId: row.on_submit_tag_id,
    onSubmitScenarioId: row.on_submit_scenario_id,
    onSubmitMessageType: row.on_submit_message_type,
    onSubmitMessageContent: row.on_submit_message_content,
    onSubmitWebhookUrl: row.on_submit_webhook_url,
    onSubmitWebhookHeaders: row.on_submit_webhook_headers,
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    saveToMetadata: Boolean(row.save_to_metadata),
    isActive: Boolean(row.is_active),
    submitCount: row.submit_count,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl: row.og_image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSubmittedAt: extra?.lastSubmittedAt ?? null,
    usedByAccounts: extra?.usedByAccounts ?? [],
  };
}

// Minimal, PUBLIC view of a form for the unauthenticated LIFF renderer.
// GET /api/forms/:id is public (auth.ts allowlist), so this MUST NOT leak
// integration credentials or internal automation config: the full serializeForm
// (used only by authenticated admin endpoints) returns on_submit_webhook_url /
// on_submit_webhook_headers — which routinely hold downstream auth headers /
// API keys — plus the tag/scenario ids. Exposing those on a public endpoint is
// the credential/config disclosure reported as #12/#15. The renderer only needs
// to KNOW that an engagement gate exists (hasEngagementGate), never its URL or
// credentials; the gate itself is now called through the server-side proxy
// endpoints below, so the browser never sees the webhook config.
function serializePublicForm(row: DbForm) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    isActive: Boolean(row.is_active),
    hasEngagementGate: Boolean(row.on_submit_webhook_url),
    // User-facing gate result strings shown in the LIFF UI — not secrets.
    onSubmitMessageContent: row.on_submit_message_content,
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl: row.og_image_url,
  };
}

// Resolve the X engagement-gate target (base URL + gate id + auth headers) from
// the form's SERVER-STORED webhook config. Never derived from client input, so
// the webhook credentials can neither be redirected to an attacker-controlled
// origin via a client ?xh param (#17) nor be handed to the browser (#12/#15).
// The stored on_submit_webhook_url has the shape
// https://<host>/api/engagement-gates/<gateId>/verify.
function resolveXGate(
  row: DbForm,
): { baseUrl: string; gateId: string; headers: Record<string, string> } | null {
  const webhookUrl = row.on_submit_webhook_url;
  if (!webhookUrl) return null;
  const gateMatch = webhookUrl.match(/engagement-gates\/([^/]+)\/verify/);
  const baseMatch = webhookUrl.match(/^(https?:\/\/[^/]+)/);
  if (!gateMatch || !baseMatch) return null;
  let headers: Record<string, string> = {};
  if (row.on_submit_webhook_headers) {
    try {
      const parsed = JSON.parse(row.on_submit_webhook_headers) as unknown;
      if (parsed && typeof parsed === 'object') {
        headers = parsed as Record<string, string>;
      }
    } catch {
      /* ignore malformed header JSON */
    }
  }
  return { baseUrl: baseMatch[1], gateId: gateMatch[1], headers };
}

function serializeSubmission(row: DbFormSubmission & { friend_name?: string | null }) {
  return {
    id: row.id,
    formId: row.form_id,
    friendId: row.friend_id,
    friendName: row.friend_name || null,
    data: JSON.parse(row.data || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

// GET /api/forms — list all forms (with submission stats + delivering accounts)
forms.get('/api/forms', async (c) => {
  try {
    const items = await getFormsWithStats(c.env.DB);
    return c.json({
      success: true,
      data: items.map((row) =>
        serializeForm(row, {
          lastSubmittedAt: row.last_submitted_at,
          usedByAccounts: row.used_by_accounts,
        }),
      ),
    });
  } catch (err) {
    console.error('GET /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id — get form
forms.get('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    // Public endpoint — return the minimal, credential-free view (#12/#15).
    return c.json({ success: true, data: serializePublicForm(form) });
  } catch (err) {
    console.error('GET /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/x-repliers — server-side proxy for the X engagement-gate
// replier list. PUBLIC (used by the LIFF form page), but the X Harness base URL
// and auth headers are resolved from the server-stored webhook config
// (resolveXGate), never from client input, so the form's webhook credentials
// stay server-side (#12/#15/#17). Degrades to an empty pool on any error so the
// LIFF page keeps working (matching the previous client-side fetch's catch).
forms.get('/api/forms/:id/x-repliers', async (c) => {
  try {
    const form = await getFormById(c.env.DB, c.req.param('id'));
    if (!form) return c.json({ success: false, error: 'Form not found' }, 404);
    const gate = resolveXGate(form);
    if (!gate) return c.json({ success: true, data: [] });
    const res = await fetch(
      `${gate.baseUrl}/api/engagement-gates/${encodeURIComponent(gate.gateId)}/repliers`,
      { headers: gate.headers },
    );
    if (!res.ok) return c.json({ success: false, data: [] });
    return c.json(await res.json());
  } catch (err) {
    console.error('GET /api/forms/:id/x-repliers error:', err);
    return c.json({ success: false, data: [] });
  }
});

// GET /api/forms/:id/x-verify?username=... — server-side proxy for X
// engagement-gate verification. Same trust model as x-repliers: credentials and
// target come from the server-stored config, never the client.
forms.get('/api/forms/:id/x-verify', async (c) => {
  try {
    const username = (c.req.query('username') ?? '').trim().replace(/^@/, '');
    if (!username) return c.json({ success: false, error: 'username required' }, 400);
    const form = await getFormById(c.env.DB, c.req.param('id'));
    if (!form) return c.json({ success: false, error: 'Form not found' }, 404);
    const gate = resolveXGate(form);
    if (!gate) return c.json({ success: false, error: 'Engagement gate not configured' }, 404);
    const res = await fetch(
      `${gate.baseUrl}/api/engagement-gates/${encodeURIComponent(gate.gateId)}/verify?username=${encodeURIComponent(username)}`,
      { headers: gate.headers },
    );
    if (!res.ok) return c.json({ success: false, error: 'verify failed' }, 502);
    return c.json(await res.json());
  } catch (err) {
    console.error('GET /api/forms/:id/x-verify error:', err);
    return c.json({ success: false, error: 'verify unavailable' }, 502);
  }
});

// POST /api/forms — create form
forms.post('/api/forms', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      fields?: unknown[];
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      onSubmitWebhookUrl?: string | null;
      onSubmitWebhookHeaders?: string | null;
      onSubmitWebhookFailMessage?: string | null;
      saveToMetadata?: boolean;
      ogTitle?: string | null;
      ogDescription?: string | null;
      ogImageUrl?: string | null;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const form = await createForm(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      fields: JSON.stringify(body.fields ?? []),
      onSubmitTagId: body.onSubmitTagId ?? null,
      onSubmitScenarioId: body.onSubmitScenarioId ?? null,
      onSubmitMessageType: body.onSubmitMessageType ?? null,
      onSubmitMessageContent: body.onSubmitMessageContent ?? null,
      onSubmitWebhookUrl: body.onSubmitWebhookUrl ?? null,
      onSubmitWebhookHeaders: body.onSubmitWebhookHeaders ?? null,
      onSubmitWebhookFailMessage: body.onSubmitWebhookFailMessage ?? null,
      saveToMetadata: body.saveToMetadata,
      ogTitle: body.ogTitle ?? null,
      ogDescription: body.ogDescription ?? null,
      ogImageUrl: body.ogImageUrl ?? null,
    });

    return c.json({ success: true, data: serializeForm(form) }, 201);
  } catch (err) {
    console.error('POST /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/forms/:id — update form
forms.put('/api/forms/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      fields?: unknown[];
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      onSubmitWebhookUrl?: string | null;
      onSubmitWebhookHeaders?: string | null;
      onSubmitWebhookFailMessage?: string | null;
      saveToMetadata?: boolean;
      isActive?: boolean;
      ogTitle?: string | null;
      ogDescription?: string | null;
      ogImageUrl?: string | null;
    }>();

    // Only include fields that were explicitly sent (avoid undefined → null conversion)
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.fields !== undefined) updates.fields = JSON.stringify(body.fields);
    if (body.onSubmitTagId !== undefined) updates.onSubmitTagId = body.onSubmitTagId;
    if (body.onSubmitScenarioId !== undefined) updates.onSubmitScenarioId = body.onSubmitScenarioId;
    if (body.onSubmitMessageType !== undefined) updates.onSubmitMessageType = body.onSubmitMessageType;
    if (body.onSubmitMessageContent !== undefined) updates.onSubmitMessageContent = body.onSubmitMessageContent;
    if (body.onSubmitWebhookUrl !== undefined) updates.onSubmitWebhookUrl = body.onSubmitWebhookUrl;
    if (body.onSubmitWebhookHeaders !== undefined) updates.onSubmitWebhookHeaders = body.onSubmitWebhookHeaders;
    if (body.onSubmitWebhookFailMessage !== undefined) updates.onSubmitWebhookFailMessage = body.onSubmitWebhookFailMessage;
    if (body.saveToMetadata !== undefined) updates.saveToMetadata = body.saveToMetadata;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.ogTitle !== undefined) updates.ogTitle = body.ogTitle;
    if (body.ogDescription !== undefined) updates.ogDescription = body.ogDescription;
    if (body.ogImageUrl !== undefined) updates.ogImageUrl = body.ogImageUrl;

    const updated = await updateForm(c.env.DB, id, updates as any);

    if (!updated) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    return c.json({ success: true, data: serializeForm(updated) });
  } catch (err) {
    console.error('PUT /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/forms/:id
forms.delete('/api/forms/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    await deleteForm(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/submissions — list submissions
forms.get('/api/forms/:id/submissions', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const submissions = await getFormSubmissions(c.env.DB, id);
    return c.json({ success: true, data: submissions.map(serializeSubmission) });
  } catch (err) {
    console.error('GET /api/forms/:id/submissions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/opened — record form open event (public, used by LIFF)
forms.post('/api/forms/:id/opened', async (c) => {
  try {
    const formId = c.req.param('id');

    // Identity is derived from the verified LINE id_token, never from a
    // client-supplied friendId/lineUserId (which could name any friend).
    const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
    const friend = callerLineUserId
      ? await getFriendByLineUserId(c.env.DB, callerLineUserId)
      : null;

    const now = jstNow();
    await c.env.DB.prepare(
      'INSERT INTO form_opens (id, form_id, friend_id, friend_name, opened_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      formId,
      friend?.id ?? null,
      friend?.display_name ?? null,
      now,
    ).run();

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/forms/:id/opened error:', err);
    return c.json({ success: true }); // non-blocking, always succeed
  }
});

// POST /api/forms/:id/partial — save survey answers without x_username (public, used by LIFF page 1)
forms.post('/api/forms/:id/partial', async (c) => {
  try {
    const body = await c.req.json<{ data?: Record<string, unknown> }>();

    // This writes to friend.metadata, so identity MUST come from the verified
    // LINE id_token — an unverified caller must not target an arbitrary friend.
    const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
    if (!callerLineUserId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    const friend = await getFriendByLineUserId(c.env.DB, callerLineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    // Save survey data to friend metadata (merge with existing)
    const existingMeta = friend.metadata ? JSON.parse(friend.metadata) : {};
    const merged = { ...existingMeta, ...body.data };
    await c.env.DB.prepare(
      'UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?',
    ).bind(JSON.stringify(merged), jstNow(), friend.id).run();

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/forms/:id/partial error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/submit — submit form (public, used by LIFF)
forms.post('/api/forms/:id/submit', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }

    const body = await c.req.json<{
      lineUserId?: string;
      friendId?: string;
      data?: Record<string, unknown>;
      _skipWebhook?: boolean;
      trackedLinkId?: string;
    }>();

    const submissionData = body.data ?? {};

    // Validate required fields
    const fields = JSON.parse(form.fields || '[]') as Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
    }>;

    for (const field of fields) {
      if (field.required) {
        const val = submissionData[field.name];
        if (val === undefined || val === null || val === '') {
          return c.json(
            { success: false, error: `${field.label} は必須項目です` },
            400,
          );
        }
      }
    }

    // Bind the submission to the verified LINE caller — never to a client-
    // supplied friendId/lineUserId (spoofable). No verified caller => anonymous
    // submission (friendId stays null), which can't be attributed to any friend.
    const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
    let friendId: string | null = null;
    if (callerLineUserId) {
      const friend = await getFriendByLineUserId(c.env.DB, callerLineUserId);
      if (friend) {
        friendId = friend.id;
      }
    }

    // Webhook gate — skip if client pre-verified via repliers endpoint
    delete submissionData._webhookVerified;
    const skipWebhook = Boolean(body._skipWebhook);
    delete submissionData._skipWebhook;
    let webhookData: Record<string, unknown> | null = null;
    if (form.on_submit_webhook_url && !skipWebhook) {
      const webhookResult = await callFormWebhook(form, submissionData);
      webhookData = webhookResult.data as Record<string, unknown> | null;
      if (!webhookResult.passed) {
        // Webhook rejected — send fail message and stop
        if (form.on_submit_webhook_fail_message && friendId) {
          const friend = await getFriendById(c.env.DB, friendId);
          if (friend?.line_user_id) {
            try {
              const { LineClient } = await import('@line-crm/line-sdk');
              let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
              if ((friend as unknown as Record<string, unknown>).line_account_id) {
                const { getLineAccountById } = await import('@line-crm/db');
                const account = await getLineAccountById(c.env.DB, (friend as unknown as Record<string, unknown>).line_account_id as string);
                if (account) accessToken = account.channel_access_token;
              }
              const lineClient = new LineClient(accessToken);
              await lineClient.pushMessage(friend.line_user_id, [{ type: 'text', text: form.on_submit_webhook_fail_message }]);
              await c.env.DB
                .prepare(
                  `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
                   VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'auto_reply', ?)`,
                )
                .bind(crypto.randomUUID(), friend.id, form.on_submit_webhook_fail_message, jstNow())
                .run();
            } catch (e) {
              console.error('Failed to send webhook fail message:', e);
            }
          }
        }
        // Still save the submission for records
        const submission = await createFormSubmission(c.env.DB, {
          formId,
          friendId: friendId || null,
          data: JSON.stringify({ ...submissionData, _webhookResult: webhookResult.data }),
        });
        return c.json({ success: true, data: { ...serializeSubmission(submission), webhookPassed: false, webhookData: webhookResult.data } }, 201);
      }
    }

    // Save submission (friendId null if not resolved — avoids FK constraint)
    const submission = await createFormSubmission(c.env.DB, {
      formId,
      friendId: friendId || null,
      data: JSON.stringify(submissionData),
    });

    // Side effects (best-effort, don't fail the request)
    if (friendId) {
      const db = c.env.DB;
      const now = jstNow();

      // Resolve reward template per-campaign.
      //
      // Priority:
      //   1. body.trackedLinkId (= ?ref= from /r/:ref → LIFF → form). This lets
      //      X Harness campaign settings drive the reward, even for friends who
      //      were originally added via a different campaign.
      //   2. Fallback to friends.first_tracked_link_id (first-touch attribution)
      //      so existing tracked links without ref pass-through still work.
      //
      // This OVERRIDES form.on_submit_message_*.
      //
      // Note: anti-replay (preventing the same friend from claiming the same
      // reward twice via URL tampering) is intentionally NOT enforced. The
      // product is opt-in oriented and the engagement gate handles real
      // anti-fraud upstream.
      let rewardTemplate: import('@line-crm/db').MessageTemplate | null = null;
      {
        const { getFriendById, getTrackedLinkById, getMessageTemplateById } = await import('@line-crm/db');
        const { resolveRewardTemplate } = await import('../services/reward-resolver.js');
        rewardTemplate = await resolveRewardTemplate(
          db,
          {
            friendId,
            requestedTrackedLinkId: body.trackedLinkId ?? null,
          },
          { getFriendById, getTrackedLinkById, getMessageTemplateById },
        );
      }

      const sideEffects: Promise<unknown>[] = [];

      // Save response data to friend's metadata
      if (form.save_to_metadata) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend) return;
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            const merged = { ...existing, ...submissionData };
            await db
              .prepare(`UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(merged), now, friendId)
              .run();
          })(),
        );
      }

      // Add tag — guarded attach so a tag_added-triggered scenario fires on
      // first-time submit (and never re-fires on duplicate submits).
      if (form.on_submit_tag_id) {
        sideEffects.push(attachTagAndFireSideEffects(db, friendId, form.on_submit_tag_id, {
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          workerUrl: c.env.WORKER_URL,
        }));
      }

      // Enroll in scenario
      if (form.on_submit_scenario_id) {
        sideEffects.push(enrollFriendInScenario(db, friendId, form.on_submit_scenario_id));
      }

      // If webhook returned a join_url (e.g. Meet Harness), send a Flex button to the user
      if (webhookData?.join_url) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend?.line_user_id) return;
            const { LineClient } = await import('@line-crm/line-sdk');
            let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
            if ((friend as unknown as Record<string, unknown>).line_account_id) {
              const { getLineAccountById } = await import('@line-crm/db');
              const account = await getLineAccountById(db, (friend as unknown as Record<string, unknown>).line_account_id as string);
              if (account) accessToken = account.channel_access_token;
            }
            const lineClient = new LineClient(accessToken);
            const joinUrl = String(webhookData!.join_url);
            const meetFlex = {
              type: 'bubble',
              header: {
                type: 'box', layout: 'vertical',
                contents: [
                  { type: 'text', text: 'ヒアリングの準備ができました', size: 'md', weight: 'bold', color: '#1e293b' },
                ],
                paddingAll: '20px', backgroundColor: '#f0f9ff',
              },
              body: {
                type: 'box', layout: 'vertical',
                contents: [
                  { type: 'text', text: 'アンケートありがとうございます。続けて短いヒアリングにご協力ください。', size: 'sm', color: '#475569', wrap: true },
                ],
                paddingAll: '20px',
              },
              footer: {
                type: 'box', layout: 'vertical',
                contents: [
                  {
                    type: 'button', style: 'primary', color: '#4CAF50',
                    action: { type: 'uri', label: 'ヒアリングを始める', uri: joinUrl },
                  },
                ],
                paddingAll: '16px',
              },
            };
            await lineClient.pushMessage(friend.line_user_id, [
              { type: 'flex', altText: 'ヒアリングの準備ができました', contents: meetFlex },
            ]);
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
                 VALUES (?, ?, 'outgoing', 'flex', ?, NULL, NULL, 'auto_reply', ?)`,
              )
              .bind(crypto.randomUUID(), friend.id, JSON.stringify(meetFlex), jstNow())
              .run();
          })(),
        );
      }

      // Send confirmation message with submitted data back to user
      sideEffects.push(
        (async () => {
          console.log('Form reply: starting for friendId', friendId);
          const friend = await getFriendById(db, friendId!);
          if (!friend?.line_user_id) { console.log('Form reply: no line_user_id'); return; }
          console.log('Form reply: sending to', friend.line_user_id);
          const { LineClient } = await import('@line-crm/line-sdk');
          // Resolve access token from friend's account (multi-account support)
          let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
          if ((friend as unknown as Record<string, unknown>).line_account_id) {
            const { getLineAccountById } = await import('@line-crm/db');
            const account = await getLineAccountById(db, (friend as unknown as Record<string, unknown>).line_account_id as string);
            if (account) accessToken = account.channel_access_token;
          }
          const lineClient = new LineClient(accessToken);
          const { buildMessage, expandVariables } = await import('../services/step-delivery.js');
          const apiOrigin = new URL(c.req.url).origin;
          const { resolveMetadata } = await import('../services/step-delivery.js');
          const resolvedMeta = await resolveMetadata(c.env.DB, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const friendData = {
            id: friend.id,
            display_name: friend.display_name,
            user_id: (friend as unknown as Record<string, string | null>).user_id,
            ref_code: (friend as unknown as Record<string, string | null>).ref_code,
            metadata: resolvedMeta,
          };

          // Build diagnostic result Flex card showing their answers
          const entries = Object.entries(submissionData as Record<string, unknown>);
          const answerRows = entries.map(([key, value]) => {
            const field = form.fields ? (JSON.parse(form.fields) as Array<{ name: string; label: string }>).find((f: { name: string }) => f.name === key) : null;
            const label = field?.label || key;
            const val = Array.isArray(value) ? value.join(', ') : (value !== null && value !== undefined && value !== '') ? String(value) : '-';
            return {
              type: 'box' as const, layout: 'vertical' as const, margin: 'md' as const,
              contents: [
                { type: 'text' as const, text: label, size: 'xxs' as const, color: '#64748b' },
                { type: 'text' as const, text: val, size: 'sm' as const, color: '#1e293b', weight: 'bold' as const, wrap: true },
              ],
            };
          });

          const resultFlex = {
            type: 'bubble', size: 'giga',
            header: {
              type: 'box', layout: 'vertical',
              contents: [
                { type: 'text', text: '診断結果', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'text', text: `${friend.display_name || ''}さんの回答`, size: 'xs', color: '#64748b', margin: 'sm' },
              ],
              paddingAll: '20px', backgroundColor: '#f0fdf4',
            },
            body: {
              type: 'box', layout: 'vertical',
              contents: [
                ...answerRows,
                { type: 'separator', margin: 'lg' },
                { type: 'text', text: '他社サービスでは、フォームの回答内容に合わせたリアルタイム返信はできません。LINE Harnessだからこそ可能な体験です。', size: 'xs', color: '#06C755', weight: 'bold', wrap: true, margin: 'lg' },
              ],
              paddingAll: '20px',
            },
          };

          const messages: ReturnType<typeof buildMessage>[] = [];

          const { buildRewardMessage } = await import('../services/reward-message.js');
          const rewardFromTrackedLink = buildRewardMessage(rewardTemplate, friend.display_name);

          if (rewardFromTrackedLink) {
            // Tracked-link reward template overrides everything (per-campaign reward)
            messages.push(rewardFromTrackedLink as ReturnType<typeof buildMessage>);
          } else if (form.on_submit_message_type && form.on_submit_message_content) {
            // Custom form message replaces default diagnostic result
            const expanded = expandVariables(form.on_submit_message_content, friendData, apiOrigin, form.on_submit_message_type);
            // 1:1 push → /t リンクに f=<friendId> を焼き込み (LIFF 識別ホップ回避)
            const { appendFriendToTrackedLinks } = await import('../services/auto-track.js');
            const decorated = await appendFriendToTrackedLinks(db, expanded, apiOrigin, friend.id);
            messages.push(buildMessage(form.on_submit_message_type, decorated));
          } else {
            // Default: send diagnostic result Flex
            messages.push(buildMessage('flex', JSON.stringify(resultFlex)));
          }

          await lineClient.pushMessage(friend.line_user_id, messages);

          // Mirror every pushed message into messages_log so the dashboard chat
          // view stays consistent with what the user actually receives in LINE.
          // Without this the form's auto-reply is invisible to operators.
          const { messageToLogPayload } = await import('../services/step-delivery.js');
          const sentAt = jstNow();
          for (const m of messages) {
            const payload = messageToLogPayload(m);
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
                 VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'auto_reply', ?)`,
              )
              .bind(crypto.randomUUID(), friend.id, payload.messageType, payload.content, sentAt)
              .run();
          }
        })(),
      );

      if (sideEffects.length > 0) {
        const results = await Promise.allSettled(sideEffects);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Form side-effect failed:', r.reason);
        }
      }
    }

    return c.json({ success: true, data: serializeSubmission(submission) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/submit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function callFormWebhook(
  form: DbForm,
  submissionData: Record<string, unknown>,
): Promise<{ passed: boolean; data: unknown }> {
  if (!form.on_submit_webhook_url) return { passed: true, data: null };

  try {
    // Replace {field_name} placeholders in URL with submitted values
    let url = form.on_submit_webhook_url;
    for (const [key, value] of Object.entries(submissionData)) {
      url = url.replace(`{${key}}`, encodeURIComponent(String(value ?? '')));
    }

    // Parse headers
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (form.on_submit_webhook_headers) {
      try {
        const parsed = JSON.parse(form.on_submit_webhook_headers) as Record<string, string>;
        Object.assign(headers, parsed);
      } catch { /* ignore invalid headers */ }
    }

    // Determine method: GET if URL has {placeholders} replaced, POST otherwise
    const isGet = form.on_submit_webhook_url.includes('{');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers,
      signal: controller.signal,
      ...(isGet ? {} : { body: JSON.stringify(submissionData) }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { passed: false, data: { error: `HTTP ${res.status}` } };
    }

    const data = await res.json() as Record<string, unknown>;

    // Check for eligibility — support both { eligible: bool } and { success: bool, data: { eligible: bool } }
    const eligible = data.eligible ?? (data.data as Record<string, unknown> | undefined)?.eligible ?? data.success;
    return { passed: Boolean(eligible), data };
  } catch (err) {
    console.error('Form webhook error:', err);
    return { passed: false, data: { error: String(err) } };
  }
}

export { forms };
