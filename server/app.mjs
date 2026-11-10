import { EVENT, validateAttendee } from '../public/domain.js';
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
export async function hash(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
}
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
async function equalSecrets(a, b) {
  const x = await hash(a), y = await hash(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail('Send JSON data.', 415);
  const raw = await request.text();
  if (encoder.encode(raw).length > 16384) fail('Request is too large.', 413);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('Invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('Send a JSON object.');
  return parsed;
}
function attendee(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, studentId: row.student_id, telegram: row.telegram,
    source: row.source, createdAt: row.created_at, checkedInAt: row.checked_in_at,
    cupNumber: row.cup_number, collectedAt: row.collected_at,
    telegramStatus: row.telegram_status || (row.telegram_chat_id ? 'connected' : 'not_connected') };
}
const JOIN = `SELECT a.*, c.number AS cup_number, c.collected_at, t.status AS telegram_status
  FROM attendees a LEFT JOIN cups c ON c.attendee_id = a.id
  LEFT JOIN telegram_outbox t ON t.attendee_id = a.id`;
async function getAttendee(db, id) { return attendee(await db.prepare(`${JOIN} WHERE a.id = ?`).bind(id).first()); }
async function getStats(db) {
  const counts = await db.prepare(`SELECT
    SUM(CASE WHEN source = 'registration' THEN 1 ELSE 0 END) AS signups,
    SUM(CASE WHEN source = 'walkin' THEN 1 ELSE 0 END) AS walkins,
    SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checkedIn FROM attendees`).first();
  const cups = await db.prepare(`SELECT
    SUM(CASE WHEN attendee_id IS NOT NULL AND collected_at IS NULL THEN 1 ELSE 0 END) AS reserved,
    SUM(CASE WHEN collected_at IS NOT NULL THEN 1 ELSE 0 END) AS collected,
    SUM(CASE WHEN attendee_id IS NULL THEN 1 ELSE 0 END) AS available FROM cups`).first();
  return { signups: counts.signups || 0, walkins: counts.walkins || 0, checkedIn: counts.checkedIn || 0,
    reserved: cups.reserved || 0, collected: cups.collected || 0, available: cups.available || 0, total: 150 };
}
async function eventState(env) {
  const settings = await env.DB.prepare('SELECT signup_open FROM event_settings WHERE id = 1').first();
  return { event: EVENT, signupOpen: Boolean(settings.signup_open), stats: await getStats(env.DB),
    mode: 'server', telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_WEBHOOK_SECRET) };
}
async function requireAdmin(request, env) {
  const token = /(?:^|;\s*)sb_session=([a-f0-9]{48})(?:;|$)/.exec(request.headers.get('cookie') || '')?.[1];
  if (!token) fail('Please sign in as an organizer.', 401);
  const row = await env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await hash(token), Date.now()).first();
  if (!row) fail('Your session expired. Please sign in again.', 401);
}
async function telegramWebhook(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) fail('Telegram is not configured.', 503);
  if (!await equalSecrets(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.TELEGRAM_WEBHOOK_SECRET)) fail('Unauthorized webhook.', 401);
  const update = await body(request), msg = update.message;
  if (msg?.chat?.type !== 'private' || typeof msg.text !== 'string') return json({ ok: true });
  const token = /^\/start(?:@[A-Za-z0-9_]+)? ([a-f0-9]{48})$/.exec(msg.text)?.[1];
  if (!token) return json({ ok: true });
  const tokenHash = await hash(token), chatId = String(msg.chat.id), time = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO telegram_outbox (attendee_id, chat_id)
      SELECT id, ? FROM attendees WHERE telegram_token_hash = ? AND telegram_token_expires > ?
      AND (telegram_chat_id IS NULL OR telegram_chat_id = ?)`)
      .bind(chatId, tokenHash, time, chatId),
    env.DB.prepare(`UPDATE attendees SET telegram_chat_id = ? WHERE telegram_token_hash = ?
      AND telegram_token_expires > ? AND (telegram_chat_id IS NULL OR telegram_chat_id = ?)`)
      .bind(chatId, tokenHash, time, chatId),
  ]);
  const person = await env.DB.prepare('SELECT id FROM attendees WHERE telegram_token_hash = ? AND telegram_chat_id = ?')
    .bind(tokenHash, chatId).first();
  if (!person) return json({ ok: true });
  const job = await env.DB.prepare(`UPDATE telegram_outbox SET status = 'sending', lease_until = ?
    WHERE attendee_id = ? AND status != 'sent' AND (status != 'sending' OR lease_until < ?)
    RETURNING attendee_id, chat_id`).bind(time + 60000, person.id, time).first();
  if (!job) {
    const existing = await env.DB.prepare('SELECT status FROM telegram_outbox WHERE attendee_id = ?').bind(person.id).first();
    if (existing?.status === 'sending') fail('Confirmation is still being sent. Please retry.', 503);
    return json({ ok: true });
  }
  const a = await getAttendee(env.DB, person.id);
  const text = `You're signed up for ${EVENT.title}!\n${EVENT.day}, ${EVENT.time} · ${EVENT.venue}\n${EVENT.dateNote}.\n${a.cupNumber ? `Bubble tea cup #${a.cupNumber} is reserved for you. Show your student ID at check-in.` : 'No bubble tea cup is reserved. You are still welcome to attend.'}`;
  try {
    const response = await (env.telegramFetch || fetch)(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: job.chat_id, text }), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Delivery failed.');
    await env.DB.prepare("UPDATE telegram_outbox SET status = 'sent', sent_at = ?, lease_until = 0 WHERE attendee_id = ?")
      .bind(now(), person.id).run();
    return json({ ok: true });
  } catch {
    await env.DB.prepare("UPDATE telegram_outbox SET status = 'failed', lease_until = 0 WHERE attendee_id = ?").bind(person.id).run();
    fail('Telegram delivery failed; the webhook can retry safely.', 503);
  }
}
export async function handleApi(request, env) {
  const url = new URL(request.url), path = url.pathname;
  try {
    if (!env.DB) fail('The database is not configured.', 503);
    if (path === '/api/telegram/webhook' && request.method === 'POST') return await telegramWebhook(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) fail('This request came from a different website.', 403);
    }
    if (path === '/api/event' && request.method === 'GET') return json(await eventState(env));
    if (path === '/api/registrations' && request.method === 'POST') {
      const input = validateAttendee(await body(request)), id = crypto.randomUUID(), token = secret();
      await env.DB.prepare(`INSERT INTO attendees
        (id, name, student_id, telegram, source, created_at, telegram_token_hash, telegram_token_expires)
        VALUES (?, ?, ?, ?, 'registration', ?, ?, ?)`)
        .bind(id, input.name, input.studentId, input.telegram, now(), await hash(token), Date.now() + 86400000).run();
      const state = await eventState(env);
      return json({ attendee: await getAttendee(env.DB, id),
        telegramUrl: state.telegramConfigured ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}` : null,
        telegramConfigured: state.telegramConfigured }, 201);
    }
    if (path === '/api/session' && request.method === 'POST') {
      if (!env.ADMIN_PASSWORD) fail('Organizer access has not been configured.', 503);
      const input = await body(request), time = Date.now();
      const client = await hash(request.headers.get('x-client-ip') || request.headers.get('cf-connecting-ip') || 'unknown');
      await env.DB.prepare(`INSERT INTO login_limits (client_hash, attempts, resets_at) VALUES (?, 0, ?)
        ON CONFLICT(client_hash) DO UPDATE SET attempts = CASE WHEN resets_at < ? THEN 0 ELSE attempts END,
        resets_at = CASE WHEN resets_at < ? THEN excluded.resets_at ELSE resets_at END`)
        .bind(client, time + 600000, time, time).run();
      const attempt = await env.DB.prepare('UPDATE login_limits SET attempts = attempts + 1 WHERE client_hash = ? AND attempts < 8 RETURNING attempts').bind(client).first();
      if (!attempt) fail('Too many sign-in attempts. Try again in 10 minutes.', 429);
      if (!await equalSecrets(String(input.password || ''), env.ADMIN_PASSWORD)) {
        fail('That organizer password is incorrect.', 401);
      }
      await env.DB.prepare('DELETE FROM login_limits WHERE client_hash = ?').bind(client).run();
      await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(time).run();
      const token = secret();
      await env.DB.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(await hash(token), time + 43200000).run();
      return json({ ok: true }, 200, { 'Set-Cookie': `sb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${url.protocol === 'https:' ? '; Secure' : ''}` });
    }
    if (path.startsWith('/api/admin/') || path === '/api/session') {
      await requireAdmin(request, env);
      if (path === '/api/session' && request.method === 'DELETE') {
        const token = /sb_session=([a-f0-9]{48})/.exec(request.headers.get('cookie'))?.[1];
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run();
        return json({ ok: true }, 200, { 'Set-Cookie': 'sb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
      }
      if (path === '/api/admin/attendees' && request.method === 'GET') {
        const rows = await env.DB.prepare(`${JOIN} ORDER BY a.created_at DESC, a.id`).all();
        return json({ ...(await eventState(env)), attendees: rows.results.map(attendee) });
      }
      if (path === '/api/admin/signup' && request.method === 'PATCH') {
        const input = await body(request);
        if (typeof input.open !== 'boolean') fail('Choose whether signup is open.');
        await env.DB.prepare('UPDATE event_settings SET signup_open = ? WHERE id = 1').bind(input.open ? 1 : 0).run();
        return json(await eventState(env));
      }
      if (path === '/api/admin/walk-ins' && request.method === 'POST') {
        const input = validateAttendee(await body(request));
        const existing = await env.DB.prepare('SELECT id FROM attendees WHERE student_id = ?').bind(input.studentId).first();
        if (existing) return json({ attendee: await getAttendee(env.DB, existing.id), existing: true });
        const id = crypto.randomUUID();
        await env.DB.prepare(`INSERT OR IGNORE INTO attendees (id, name, student_id, telegram, source, created_at, checked_in_at)
          VALUES (?, ?, ?, ?, 'walkin', ?, ?)`)
          .bind(id, input.name, input.studentId, input.telegram, now(), now()).run();
        const inserted = await getAttendee(env.DB, id);
        if (inserted) return json({ attendee: inserted, existing: false }, 201);
        const raced = await env.DB.prepare('SELECT id FROM attendees WHERE student_id = ?').bind(input.studentId).first();
        return json({ attendee: await getAttendee(env.DB, raced.id), existing: true });
      }
      const action = /^\/api\/admin\/attendees\/([a-zA-Z0-9-]+)\/(check-in|collect)$/.exec(path);
      if (action && request.method === 'POST') {
        const [, id, verb] = action, existing = await getAttendee(env.DB, id);
        if (!existing) fail('Attendee not found.', 404);
        if (verb === 'check-in') {
          await env.DB.prepare('UPDATE attendees SET checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ?').bind(now(), id).run();
          return json({ attendee: await getAttendee(env.DB, id), alreadyDone: Boolean(existing.checkedInAt) });
        }
        if (!existing.checkedInAt) fail('Check this student in before handing out a cup.', 409);
        const claimed = await env.DB.prepare(`UPDATE cups SET attendee_id = ?, collected_at = ?
          WHERE number = COALESCE((SELECT number FROM cups WHERE attendee_id = ?),
            (SELECT MIN(number) FROM cups WHERE attendee_id IS NULL))
          AND collected_at IS NULL AND (attendee_id IS NULL OR attendee_id = ?)
          AND EXISTS (SELECT 1 FROM attendees WHERE id = ? AND checked_in_at IS NOT NULL)
          RETURNING number`).bind(id, now(), id, id, id).first();
        const updated = await getAttendee(env.DB, id);
        if (!claimed && !updated.collectedAt) fail('All 150 cups are reserved or collected. Check-in is still available.', 409);
        return json({ attendee: updated, alreadyDone: !claimed });
      }
    }
    return json({ error: 'Endpoint not found.' }, 404);
  } catch (error) {
    const message = String(error.message || '');
    if (/signup_closed/.test(message)) return json({ error: 'Signup is closed. You can still ask the organizer to check you in at the door.' }, 409);
    if (/UNIQUE constraint failed: attendees.student_id/.test(message)) return json({ error: 'This student ID is already registered. Ask an organizer to find your entry.' }, 409);
    if (error.status) return json({ error: message }, error.status);
    if (/Enter /.test(message)) return json({ error: message }, 400);
    console.error('API request failed:', path, error.name);
    return json({ error: 'Something went wrong. Please try again; ask an organizer if it continues.' }, 500);
  }
}
