import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/sqlite.mjs';
import { handleApi } from '../server/app.mjs';

async function setup(t, extra = {}) {
  const DB = openDatabase(); t.after(() => DB.close());
  const env = { DB, ADMIN_PASSWORD: 'test-only-password', ...extra };
  let cookie = '';
  async function request(path, method = 'GET', input, headers = {}) {
    const response = await handleApi(new Request(`https://event.test/api/${path}`, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(input ? { body: JSON.stringify(input) } : {}),
    }), env);
    return { status: response.status, data: await response.json(), response };
  }
  async function login() {
    const r = await request('session', 'POST', { password: env.ADMIN_PASSWORD });
    assert.equal(r.status, 200); cookie = r.response.headers.get('set-cookie').split(';')[0];
  }
  const signup = (n, more = {}) => request('registrations', 'POST', { name: `Student ${n}`, studentId: `A${String(n).padStart(7, '0')}B`, telegram: 'sample_student', ...more });
  return { env, request, signup, login };
}
test('151 concurrent registrations reserve exactly 150 cups, and attendance remains open', async t => {
  const { signup, request, login } = await setup(t);
  const responses = await Promise.all(Array.from({ length: 151 }, (_, i) => signup(i)));
  assert.ok(responses.every(r => r.status === 201));
  const slots = responses.map(r => r.data.attendee.cupNumber).filter(Boolean);
  assert.equal(slots.length, 150); assert.equal(new Set(slots).size, 150);
  const state = (await request('event')).data;
  assert.equal(state.stats.available, 0); assert.equal(state.stats.signups, 151);
  await login();
  const noCup = responses.find(r => !r.data.attendee.cupNumber).data.attendee;
  assert.equal((await request(`admin/attendees/${noCup.id}/check-in`, 'POST', {})).status, 200);
  assert.equal((await request(`admin/attendees/${noCup.id}/collect`, 'POST', {})).status, 409);
});
test('normalized duplicate student IDs cannot allocate another cup or reveal a receipt', async t => {
  const { signup, request } = await setup(t);
  const r = await signup(1);
  assert.equal(r.status, 201);
  const duplicate = await signup(2, { name: 'Different Person', studentId: ' a0000001b ' });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.attendee, undefined);
  assert.equal((await request('event')).data.stats.reserved, 1);
});
test('walk-ins cannot take reserved cups; remaining stock stays consistent for later signups', async t => {
  const { request, signup, login } = await setup(t); await login();
  const w = (await request('admin/walk-ins', 'POST', { name: 'Walk In', studentId: 'WALK0001' })).data.attendee;
  assert.equal(w.cupNumber, null); assert.ok(w.checkedInAt);
  const claimed = await request(`admin/attendees/${w.id}/collect`, 'POST', {});
  assert.equal(claimed.status, 200);
  const responses = await Promise.all(Array.from({ length: 150 }, (_, i) => signup(i)));
  assert.equal(responses.filter(r => r.data.attendee.cupNumber).length, 149);
  const stats = (await request('event')).data.stats;
  assert.equal(stats.reserved + stats.collected, 150); assert.equal(stats.available, 0);
  const w2 = (await request('admin/walk-ins', 'POST', { name: 'Second Walkin', studentId: 'WALK0002' })).data.attendee;
  assert.equal((await request(`admin/attendees/${w2.id}/collect`, 'POST', {})).status, 409);
  assert.equal((await request('event')).data.stats.checkedIn, 2);
});
test('two organizer sessions cannot collect the same reserved cup twice', async t => {
  const { request, signup, login, env } = await setup(t); await login();
  const a = (await signup(1)).data.attendee;
  assert.equal((await request(`admin/attendees/${a.id}/collect`, 'POST', {})).status, 409);
  await request(`admin/attendees/${a.id}/check-in`, 'POST', {});
  const signin = await handleApi(new Request('https://event.test/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env);
  const otherCookie = signin.headers.get('set-cookie').split(';')[0];
  const responses = await Promise.all([
    request(`admin/attendees/${a.id}/collect`, 'POST', {}),
    request(`admin/attendees/${a.id}/collect`, 'POST', {}, { cookie: otherCookie }),
  ]);
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(responses.filter(r => r.data.alreadyDone === false).length, 1);
  assert.equal((await request('event')).data.stats.collected, 1);
  const again = await request(`admin/attendees/${a.id}/check-in`, 'POST', {});
  assert.equal(again.data.alreadyDone, true);
});
test('closing signup still allows staff walk-in check-in and survives independent requests', async t => {
  const { request, signup, login } = await setup(t); await login();
  await request('admin/signup', 'PATCH', { open: false });
  assert.equal((await signup(1)).status, 409);
  assert.equal((await request('admin/walk-ins', 'POST', { name: 'Still Welcome', studentId: 'WALK0001' })).status, 201);
  assert.equal((await request('event')).data.signupOpen, false);
  await request('admin/signup', 'PATCH', { open: true });
  assert.equal((await signup(1)).status, 201);
});
test('organizer data requires authentication; cross-origin changes and bad input are rejected', async t => {
  const { request, signup, login } = await setup(t);
  assert.equal((await request('admin/attendees')).status, 401);
  assert.equal((await request('admin/signup', 'PATCH', { open: false })).status, 401);
  assert.equal((await signup(1, { studentId: '' })).status, 400);
  assert.equal((await signup(1, { telegram: 'not valid!' })).status, 400);
  const publicState = (await request('event')).data;
  assert.equal(publicState.attendees, undefined); assert.equal(publicState.telegramUrl, undefined);
  await login();
  assert.equal((await request('admin/signup', 'PATCH', { open: false }, { origin: 'https://evil.test' })).status, 403);
  await request('session', 'DELETE');
  assert.equal((await request('admin/attendees')).status, 401);
});
test('Telegram remains explicitly unconfigured without credentials', async t => {
  const { signup, request } = await setup(t);
  const receipt = (await signup(1)).data;
  assert.equal(receipt.telegramConfigured, false); assert.equal(receipt.telegramUrl, null);
  assert.equal((await request('telegram/webhook', 'POST', {})).status, 503);
});
test('concurrent wrong-password attempts are limited atomically', async t => {
  const { request } = await setup(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => request('session', 'POST', { password: 'wrong' })));
  assert.equal(results.filter(r => r.status === 401).length, 8);
  assert.equal(results.filter(r => r.status === 429).length, 12);
});
test('concurrent duplicate walk-ins resolve to the same existing entry', async t => {
  const { request, login } = await setup(t); await login();
  const results = await Promise.all(Array.from({ length: 5 }, () => request('admin/walk-ins', 'POST', { name: 'Walk In', studentId: 'WALK0001' })));
  assert.equal(new Set(results.map(r => r.data.attendee.id)).size, 1);
  assert.equal(results.filter(r => r.data.existing === false).length, 1);
});
test('Telegram Start links expire, require the webhook secret, and deduplicate delivered confirmations', async t => {
  let sent = 0;
  const { request, signup, login, env } = await setup(t, {
    TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_BOT_USERNAME: 'study_test_bot', TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    telegramFetch: async () => { sent++; return new Response(JSON.stringify({ ok: true })); },
  });
  const result = (await signup(1)).data;
  const token = new URL(result.telegramUrl).searchParams.get('start');
  assert.match(token, /^[a-f0-9]{48}$/);
  const update = { update_id: 1, message: { chat: { id: 123, type: 'private' }, text: `/start ${token}` } };
  assert.equal((await request('telegram/webhook', 'POST', update)).status, 401);
  const auth = { 'X-Telegram-Bot-Api-Secret-Token': 'test-secret' };
  assert.equal((await request('telegram/webhook', 'POST', update, auth)).status, 200);
  assert.equal((await request('telegram/webhook', 'POST', update, auth)).status, 200);
  assert.equal(sent, 1);
  await login();
  assert.equal((await request('admin/attendees')).data.attendees[0].telegramStatus, 'sent');
  const other = (await signup(2)).data;
  await env.DB.prepare('UPDATE attendees SET telegram_token_expires = 0 WHERE id = ?').bind(other.attendee.id).run();
  const expired = { ...update, message: { ...update.message, text: `/start ${new URL(other.telegramUrl).searchParams.get('start')}` } };
  await request('telegram/webhook', 'POST', expired, auth); assert.equal(sent, 1);
});
test('failed Telegram delivery can be retried without changing the registration or cup', async t => {
  let attempts = 0;
  const { request, signup } = await setup(t, {
    TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_BOT_USERNAME: 'study_test_bot', TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    telegramFetch: async () => new Response(JSON.stringify({ ok: ++attempts > 1 })),
  });
  const result = (await signup(1)).data;
  const update = { message: { chat: { id: 123, type: 'private' }, text: `/start ${new URL(result.telegramUrl).searchParams.get('start')}` } };
  const auth = { 'X-Telegram-Bot-Api-Secret-Token': 'test-secret' };
  assert.equal((await request('telegram/webhook', 'POST', update, auth)).status, 503);
  assert.equal((await request('telegram/webhook', 'POST', update, auth)).status, 200);
  assert.equal(attempts, 2); assert.equal((await request('event')).data.stats.reserved, 1);
});
