import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import { openDatabase } from '../server/sqlite.mjs';
test('Worker transport ignores forged x-client-ip for organizer login throttling', async t => {
  const DB = openDatabase(); t.after(() => DB.close());
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => worker.fetch(new Request('https://event.test/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-ip': `spoof-${i}`, 'cf-connecting-ip': '192.0.2.1' },
    body: JSON.stringify({ password: 'wrong' }),
  }), { DB, ADMIN_PASSWORD: 'test-only-password' })));
  assert.equal(responses.filter(r => r.status === 401).length, 8);
  assert.equal(responses.filter(r => r.status === 429).length, 4);
});
test('Worker serves static assets with browser security headers', async () => {
  const response = await worker.fetch(new Request('https://event.test/'), { ASSETS: { fetch: async () => new Response('hello') } });
  assert.equal(await response.text(), 'hello');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
});
