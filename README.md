# Study Break Night

Phone-friendly student registration, organizer check-in and a shared limit of 150 bubble tea cups.

**[Open the live website →](https://study-break-checkin.study-break-checkin.workers.dev/)**

[Organizer sign-in](https://study-break-checkin.study-break-checkin.workers.dev/#organizer) · [Hosting guide](docs/deploy.md) · [GitHub Pages entry point](https://ngcanhh.github.io/CheckinComp/)

**Organizer password: `Computing`** (case-sensitive; no username required).

This organizer login is intentionally public for evaluation. Anyone who reads it can view/export attendee details and use the organizer controls. Use fictitious student details when reviewing this public version.

The live app runs on **Cloudflare Workers + D1**. Students can register on their own phones, and organizers see the same list and cup totals on other devices. Entries stay in a shared database when phones or the host computer are closed. The app starts with no preloaded students.

[Phone registration](docs/screenshots/shared-phone-signup.jpg) · [Organizer sign-in](docs/screenshots/shared-phone-signin.jpg)

## Use the website

1. Share the live website with students. Registration asks for full name, student ID and an optional Telegram username.
2. While cups remain, registration reserves one cup. The confirmation shows the event details and cup status. After all 150 cups are allocated, students can still register without a cup reservation.
3. Choose **Organizer** and sign in with the password above. Each device gets its own session.
4. Find the student, check their physical ID, tap **Check in**, then **Hand out cup** when they collect it. Attendance and collection are separate.
5. Use **+ Add walk-in** for an unregistered arrival. Walk-ins can collect only unreserved cups.
6. Use **Close signup** to stop online registration. Organizer check-in and walk-ins can continue.
7. Choose **Export CSV** to download the full list for Google Sheets or Excel. Search and filters do not limit the export.
8. For a mistaken entry, choose **Remove** beside that student and confirm their name and student ID in the prompt.

Organizer lists refresh every five seconds while visible. A successful action rechecks the database, so old screens cannot bypass the cup cap. Refreshing or changing devices does not reset the shared list. There is no public sample loader or database reset button.

The event currently says **Thursday, 7–9 PM, COM1 foyer**, Singapore time. The exact date is visibly pending confirmation. Update `EVENT` in `public/domain.js` when confirmed.

### Remove a mistaken attendee

**Remove** is available only after organizer sign-in and asks for confirmation. It removes that student's entry and check-in from the visible list and updates totals on other devices.

- **Cup not collected:** the entry is deleted, any reservation returns to stock and the student ID can be registered again with corrected details. Associated Telegram confirmation jobs are removed.
- **Cup already collected:** the entry is hidden, but its original database record and collected cup remain counted. The student ID cannot register or collect another cup. Removing a name does not put a physically handed-out drink back into stock.

This cannot be undone from the app. Export first if a historical copy is needed. Removing an entry is not a substitute for returning a physical cup or correcting a collection recorded by mistake. The shared app has no delete-all button.

[Remove button on a phone](docs/screenshots/phone-remove-attendee.jpg) — a fictitious entry in an isolated local preview, not a student seeded into the live event.

## Data storage

| Component | Purpose |
| --- | --- |
| Cloudflare Worker | Serves the website and handles registration, sessions, check-in and cup collection |
| Cloudflare D1 | Stores the shared attendee list, 150 cup slots and organizer sessions |
| GitHub | Stores source code, documentation and automated checks |
| GitHub Pages | Redirects the old public link to the shared Cloudflare website |
| CSV export | Downloads a snapshot for Sheets/Excel and event reporting |

The shared database was selected because allocations and collection need atomic updates across devices. Student IDs are normalized and unique. Anonymous endpoints do not return the attendee list. Organizer sessions use server-verified HttpOnly cookies, with Secure on HTTPS, a 12-hour lifetime and sign-in throttling.

Earlier GitHub Pages releases saved entries only in each browser. Those old browser entries and local `data/event.sqlite` files are **not automatically imported** into Cloudflare D1. The current shared deployment uses its own database. The browser-storage implementation remains in the source for automated tests and optional local use; the published entry point redirects to shared mode.

### Google Sheets and Excel

**Export CSV** includes full name, student ID, Telegram username, entry type, check-in, cup number/status and timestamps in Singapore time. UTF-8 preserves Vietnamese names, and user-entered spreadsheet formula prefixes are escaped.

In Google Sheets choose **File → Import → Upload** and select the CSV. Excel can open it or import it as UTF-8. Export is a snapshot; later changes require another export. Automatic Google Sheets synchronization is not configured.

## The 150-cup rule

`reserved + collected + unreserved = 150`

- Registration reserves one available numbered slot in the same database statement as the signup.
- One student ID has one entry and at most one cup.
- Check-in does not itself record collection. Repeated taps preserve the original action.
- Walk-ins can collect only unreserved stock; existing reservations stay protected.
- When all 150 cups are allocated, registration and attendance continue but new cup claims are blocked.
- No-show reservations stay held until event end. There is no automatic release or waitlist promotion.
- Removing an uncollected attendee releases its slot; removing a collected attendee never replenishes stock.

The rule is enforced by D1, not by a counter in a phone's browser. Two organizer devices cannot claim the same cup through stale screens.

## Interface

NUS-inspired blue `#003D7C` and orange `#EF7C00`, with Arial/Helvetica and no downloaded fonts. Phone layouts use attendee cards, large tap targets and 16px form inputs. Study Break has its own identity rather than the NUS logo.

## Run locally

Install **Node.js 24 or newer**. The Node app has no application dependencies and needs no install or build step.

```sh
npm start
```

Open `http://127.0.0.1:3000` on that computer. The local organizer password is in `data/organizer-key.txt`; keep it private. Local entries live in `data/event.sqlite` and survive restarts. An optional `.env` is read by `npm start`.

For phones on the same trusted Wi-Fi, run `HOST=0.0.0.0 npm start` and open `http://YOUR-COMPUTER-LAN-IP:3000`. This is a separate local database, not the public D1 database. The computer must stay awake for local hosting; the Cloudflare site stays online independently.

## Publish updates

Cloudflare is deployed from the project directory:

```sh
npx wrangler@latest deploy
```

The existing D1 database survives Worker deployments. Apply remote migrations only when a new migration is added. `public/deployment.json` stays in `mode: "server"` so the hosted app uses the shared API.

The [Pages workflow](.github/workflows/pages.yml) runs checks and tests, then publishes the `pages/` redirect from `codex/event-checkin` or `main`. A GitHub push updates that redirect and documentation; it does not automatically deploy changes to the Cloudflare Worker.

Keep `.env`, `.dev.vars`, `.wrangler/`, `data/`, Cloudflare credentials and bot tokens out of Git. Only the owner-approved public organizer login is documented here. The D1 database ID in `wrangler.toml` is a resource identifier, not an API credential.

## Telegram

Real Telegram delivery is **not connected**. A username alone cannot enable DMs. The confirmation explicitly says that no Telegram message was sent.

The optional integration requires a bot token, webhook secret, public HTTPS webhook and the student opening the bot and pressing **Start**. Mocked tests cover delivery, expiration and retries; live bot delivery is not claimed. See [setup](docs/deploy.md#optional-telegram).

## Validation and limitations

```sh
npm run check
npm test
```

The 27 automated tests cover 151 signups against the 150-cup cap, duplicate IDs, walk-ins, attendee removal and collection races, reservation release, retained collected stock, signup closure, authentication, Worker transport, Telegram retries, CSV encoding/formula protection and the optional browser-storage implementation.

Deployment checks confirmed HTTPS access, shared server mode, zero initial attendees, 150 unreserved cup slots and organizer login. The published `Computing` password was verified against the live server, and the verification session was signed out. Physical two-phone signup/check-in testing remains an event acceptance check.

The live removal check created one temporary test registration, verified it from an organizer session, rejected unauthenticated deletion, removed it and repeated the delete safely. Existing attendee totals and cup availability were unchanged after cleanup. No test student was left in the live list.

What can break at the door:

- **Internet/hosting outage:** shared mode needs connectivity. The last list is retained and door actions are disabled when stale. There is no offline queue; keep a manual fallback and reconcile before resuming cup claims.
- **Eligibility:** unique IDs do not prove identity. Staff should check physical student ID.
- **Session/password:** organizers need the event password and may need to sign in again after 12 hours. The Cloudflare organizer password is configured separately from the local password file.
- **Public organizer access:** the published login lets readers view/export attendee records and change event state. Before collecting real student details, rotate to a private organizer password and restrict access. Decide retention after the event. There is no public delete-all control.
- **Event setup:** the exact date and optional Telegram bot still need organizer configuration.
- **Hosting limits:** Workers and D1 free tiers have quotas. CSV is not a database backup or an automatic Sheets connection.

## Files

```text
public/             Phone UI, shared API client and CSV export
server/             Shared API, SQLite host and Telegram setup
worker.mjs          Cloudflare Worker + asset adapter
wrangler.toml       Worker and D1 resource configuration
migrations/         Database schema and atomic 150-cup rules
pages/              Old GitHub Pages URL redirect
tests/              API, Worker, CSV and optional browser tests
docs/               Hosting and operations guide
.github/workflows/  Automated checks and Pages redirect publication
```

AI assisted with implementation, design and tests. Optional integrations are not presented as active features.

References: [Workers](https://developers.cloudflare.com/workers/), [D1](https://developers.cloudflare.com/d1/), [NUS colours](https://www.nus.edu.sg/identity/guidelines/corporate-colours), [Telegram limitations](https://core.telegram.org/bots#how-are-bots-different-from-humans).
