const [site] = process.argv.slice(2);
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;
if (!site || !token || !secret) throw new Error('Provide your public HTTPS site URL and set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.');
const url = new URL('/api/telegram/webhook', site);
if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Telegram requires a publicly reachable HTTPS URL.');
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error('Use 1–256 letters, digits, underscores or hyphens for the webhook secret.');
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: url.href, secret_token: secret, allowed_updates: ['message'] }),
  signal: AbortSignal.timeout(15000),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error('Telegram could not set the webhook. Check the bot credentials and public URL.');
console.log(`Webhook configured for ${url.origin}. Test signup → open Telegram → Start.`);
