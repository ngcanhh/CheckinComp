# Deploy the shared version to Cloudflare

The GitHub Pages link is a **single-browser demo**. For students to register on their own phones and organizers to see the same list on one or two devices, deploy the complete Worker + D1 version below. The app and database can use Cloudflare's free tiers, subject to their current limits. No paid add-ons or custom domain are needed.

## 1. Create an account and sign in

Create a [Cloudflare account](https://dash.cloudflare.com/sign-up). Install Node.js 24 LTS, which normally includes npm. In this project's directory, run:

```sh
npx wrangler login
```

Complete the sign-in in your own browser. Never send passwords or Cloudflare API tokens in chat.

## 2. Create the shared database

```sh
npx wrangler d1 create study-break-checkin
```

Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Keep `binding = "DB"`.

```sh
npx wrangler d1 migrations apply study-break-checkin --remote
```

The migration creates the event settings, attendees, 150 cup slots and organizer sessions. It does not seed fake students.

## 3. Publish the app and protect organizer access

```sh
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD
```

Enter a strong password at the prompt. Give it only to the organizers; both devices can use the same password with independent sessions. Complete this step **before sharing the site**. The organizer API refuses login until this secret exists.

Open the `workers.dev` URL printed by Wrangler. Verify signup on one phone and check-in on a second device. Use this URL for the actual event, rather than the GitHub Pages demo. There is no separate frontend build or CORS configuration.

To publish edits later, run `npx wrangler deploy` again. Run migrations again only when adding a new migration. The D1 database survives Worker deployments.

## 4. Connect Telegram (optional)

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, and choose a name and username. Keep the returned token private.
2. Add the three Worker secrets below, entering each value at its prompt. The username has no `@` prefix. The webhook secret should be a long random string containing only letters, digits, `_` or `-`.

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_BOT_USERNAME
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

3. Copy `.env.example` to a local `.env`. Put the same Telegram token, username and webhook secret there. `.env` is ignored by Git. Configure the public webhook:

```sh
node --env-file=.env server/configure-telegram.mjs https://YOUR-WORKER.workers.dev
```

4. Make a new signup, choose **Get Telegram confirmation**, and press **Start** in Telegram. The bot should reply with event details and the cup reservation status. Organizer rows show **Confirmed** only after the send API reports success. No bot message is sent solely from a typed handle.

Do not put a login wall in front of `/api/telegram/webhook`: Telegram must reach it via HTTPS. Requests are authenticated with the webhook secret header. Starting this bot must not also run `getUpdates` polling; Telegram polling and webhooks are mutually exclusive.

If the bot is not configured, registration and check-in still work. The success page explicitly says no Telegram message has been sent. Links expire after 24 hours; an expired link does not cancel the signup or cup.

## 5. Before sharing with students

- Confirm the calendar date and update `EVENT` in `public/domain.js`. The current demo says Thursday, 7–9 PM, COM1 foyer, with the date pending.
- Verify signup, one reservation, staff check-in and cup collection using a test database before the event. Use a fresh production database when ready.
- Confirm the food policy: cups are held for registered students until event end; no-show reservations are not automatically released.
- Verify both organizer devices have internet and the organizer password. Check the shared totals agree.
- Decide who retains or deletes student data after the event. The app has no automatic retention policy or destructive organizer reset button.

## References

- [Cloudflare D1 setup](https://developers.cloudflare.com/d1/get-started/)
- [Worker static assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/)
- [D1 pricing and free limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Telegram bot setup](https://core.telegram.org/bots/tutorial#obtain-your-bot-token)
- [Telegram deep links](https://core.telegram.org/bots/features#deep-linking)
