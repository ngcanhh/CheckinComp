# Hosting and operating Study Break Night

## Live shared website

- Website: https://study-break-checkin.study-break-checkin.workers.dev/
- Organizer sign-in: https://study-break-checkin.study-break-checkin.workers.dev/#organizer
- Old entry point: https://ngcanhh.github.io/CheckinComp/ (redirects to the shared website)
- Worker: `study-break-checkin`
- Database: `study-break-checkin`, bound to the Worker as `DB`
- Storage: Cloudflare D1, with the primary database in APAC
- Mode: `server` in `public/deployment.json`

All phones use the same attendee list and the same 150 cup slots. The host computer can be switched off. The shared deployment begins without preloaded students.

Initial checks confirmed the public API in shared server mode, zero attendees, 150 unreserved cups, and a configured organizer secret. The owner confirmed successful organizer login. Automated tests ran before deployment; physical two-phone event testing remains a final acceptance check.

The organizer password is stored at runtime as the Cloudflare secret `ADMIN_PASSWORD`, separately from the local Node password. For the public evaluation site, the owner has explicitly published the password **`Computing`** in the README. No username is required. Anyone with this login can view/export attendee details and use organizer controls; use fictitious data for public reviews. Cloudflare credentials and Telegram tokens remain private.

## Update the existing deployment

From this project directory, with Node.js 24 or newer:

```sh
npx wrangler@latest login
npx wrangler@latest whoami
npm run check
npm test
npx wrangler@latest deploy
```

Login is needed only when the existing session is missing or expired. The deploy output prints the public URL. Keep `binding = "DB"` and the existing database ID in `wrangler.toml`; publishing code does not recreate the database or erase attendees.

When a new migration file is added:

```sh
npx wrangler@latest d1 migrations apply study-break-checkin --remote
npx wrangler@latest deploy
```

Use `--remote` for the hosted database. Local Wrangler data and local `data/event.sqlite` are separate stores.

To replace the organizer password, type it interactively in your own Terminal:

```sh
npx wrangler@latest secret put ADMIN_PASSWORD
```

The current evaluation password is intentionally public. Before using the site for real student records, replace it with a private password and update the public access instructions. Keep private credentials out of shell commands, `.env.example` and GitHub. Changing `ADMIN_PASSWORD` does not revoke existing organizer sessions; they expire after 12 hours.

## GitHub and the old Pages link

The Pages workflow publishes the small redirect in `pages/`. It preserves the `#organizer` fragment when JavaScript runs, and includes a direct link as a fallback. It no longer publishes an independent browser-storage event list.

GitHub pushes update source, documentation and the Pages redirect. **Worker code changes still need `npx wrangler@latest deploy`**; Cloudflare is not automatically connected to GitHub Builds.

Entries from the old browser-only website are not imported automatically. Export them before clearing browser storage if you need a historical copy. The shared app has no CSV import feature and no public delete-all button.

## Set up a separate Cloudflare account

These steps are for a new deployment, not for routine updates to the existing event:

1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up), verify its email and run `npx wrangler@latest login`.
2. Create a fresh database:

```sh
npx wrangler@latest d1 create study-break-checkin --location apac --update-config=false
```

3. Replace `database_id` in `wrangler.toml` with the ID printed for the new account. Keep `binding = "DB"`, `database_name = "study-break-checkin"` and `migrations_dir = "migrations"`. Do not reuse the existing event's ID in another account.
4. Initialize and deploy:

```sh
npx wrangler@latest d1 migrations apply study-break-checkin --remote
npx wrangler@latest deploy
npx wrangler@latest secret put ADMIN_PASSWORD
```

5. Before sharing the URL, confirm HTTPS works, Organizer requires a password, and students on separate devices see the same shared totals. A brand-new `workers.dev` address may not be immediately reachable; investigate DNS/TLS if the deploy succeeds but the page does not open. Do not bypass browser certificate warnings.
6. Update the URLs in the README, this guide, `pages/index.html` and `pages/redirect.js` to the verified new URL.

The application and database can use Cloudflare free tiers, subject to quotas. A paid domain is not required.

## Optional Telegram

Telegram delivery is not currently connected. Registration, check-in, cup collection and CSV export work independently.

1. Create a bot using [@BotFather](https://t.me/BotFather). Keep its token private.
2. Add these secrets interactively:

```sh
npx wrangler@latest secret put TELEGRAM_BOT_TOKEN
npx wrangler@latest secret put TELEGRAM_BOT_USERNAME
npx wrangler@latest secret put TELEGRAM_WEBHOOK_SECRET
```

The username has no `@` prefix. The webhook secret should be a random value containing only letters, digits, `_` or `-`.

3. Copy `.env.example` to a private local `.env`, fill in the same Telegram settings, then configure the webhook:

```sh
node --env-file=.env server/configure-telegram.mjs https://study-break-checkin.study-break-checkin.workers.dev
```

4. Register, choose **Get Telegram confirmation**, open the bot and press **Start**. Verify a real reply. The app shows confirmation delivery only after the Telegram API reports success. A typed username alone does not allow DMs.

The webhook must remain publicly reachable over HTTPS; it verifies its secret header. Do not run `getUpdates` polling alongside this webhook. Start links expire after 24 hours. The app does not silently treat an unconfigured or failed delivery as sent.

## Event checks

- Confirm the exact date in `public/domain.js`; the current site still marks it pending.
- Open the same shared URL on two devices. After a test registration, confirm the organizer list and totals update.
- Check physical student ID, then record attendance and cup collection separately.
- Keep both organizer devices online and the organizer password available.
- Export CSV for Sheets/Excel reports. Export is a snapshot, not automatic synchronization or a restorable database backup.
- Agree on retention of student data and use Cloudflare database management for any required deletion; the shared UI has no reset button.
- Keep a manual fallback for outages. No-show reservations are not automatically released.

## References

- [Cloudflare D1 setup](https://developers.cloudflare.com/d1/get-started/)
- [Worker assets](https://developers.cloudflare.com/workers/static-assets/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Telegram bot limitations](https://core.telegram.org/bots#how-are-bots-different-from-humans)
