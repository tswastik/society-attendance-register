# Project Understanding — Society Staff Attendance System

This document explains **how the code works**: the end-to-end flow, what each file is responsible
for, and how the pieces connect. For setup/deployment instructions, see [README.md](README.md).

## 1. What this system does

House Keeping, Security Guard, Society Manager and Other staff check in/out of the society by
scanning one static QR code mounted at the gate with their phone's camera. The system:

- Verifies they're physically near the gate (geolocation geofence) before logging the entry.
- Automatically alternates Check-In → Check-Out → Check-In... per staff member, so checkout is
  never possible without a prior check-in.
- Nags anyone still checked in after 8 hours or past a nightly cutoff hour (default 10 PM) via a
  real push notification.
- Stores everything in a Google Sheet (no separate database).
- Gives the society admin a password-protected mobile dashboard of who's in/out.

## 2. High-level architecture

```
┌─────────────────┐        ┌──────────────────────────┐        ┌───────────────────┐
│  Staff's phone   │        │   Node/Express server    │        │   Google Sheet     │
│  (PWA, no login) │◄──────►│   (server/src)           │◄──────►│  Staff + Attendance │
└─────────────────┘  HTTPS  └──────────────────────────┘ Sheets │     AttendanceLog   │
        │                          │        ▲                  API └───────────────────┘
        │ scans gate QR            │        │
        ▼                          │  push.js (Firebase Admin)
┌─────────────────┐                │        │
│ Admin's phone/PC │◄───────────────┘        ▼
│ (password login) │                 ┌──────────────────┐
└─────────────────┘                 │  Staff's phone     │
                                     │  (push notification)│
                                     └──────────────────┘

External: cron-job.com calls POST /api/jobs/trigger every 15 min so reminders still fire even
if the free-tier host (Render) has put the app to sleep.
```

The server is the only thing that talks to Google Sheets and Firebase — the browser/PWA never
holds credentials, it only calls the server's own `/api/*` endpoints.

## 3. Data model (the Google Sheet)

Two tabs, auto-created on first run by `sheets.ensureSheetsExist()` if missing.

**`Staff`** — one row per registered person:
| StaffId | Name | Category | Phone | FcmToken | RegisteredAt |
|---|---|---|---|---|---|
| UUID | text | one of House Keeping / Security Guard / Society Manager / Others | optional | Firebase push token, blank until they enable push | ISO timestamp |

**`AttendanceLog`** — one row per scan:
| LogId | StaffId | Name | Category | Type | Timestamp | Lat | Lng | DistanceMeters | GateId | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| UUID | FK → Staff | denormalized for easy reading in the Sheet | `CheckIn` / `CheckOut` | ISO timestamp | scan's GPS | scan's GPS | distance from gate at scan time | `main` | see below |

`Note` is a small reused flag field, overloaded for two unrelated purposes (by design, to avoid
adding more Sheet columns for a low-volume use case):
- An **ISO timestamp** → "don't send another 8-hour reminder until this time" (set after a
  reminder is sent, or after the staff member taps "still on duty").
- The literal string **`NIGHT:<YYYY-MM-DD>`** → "the night-cutoff reminder was already sent today",
  so repeated external-scheduler pings during the cutoff hour don't spam the same person.

There is **no "current status" column** — whether someone is checked in is always derived by
finding their most recent `AttendanceLog` row and checking if `Type === 'CheckIn'`. This is the
single source of truth the whole system relies on (see `getLatestLogForStaff` in `sheets.js`).

## 4. Backend (`server/`)

### 4.1 Entry point — `src/index.js`

Boots the Express app:
1. Mounts the four route groups (`/api/staff`, `/api/attendance`, `/api/dashboard`, `/api/jobs`).
2. Exposes `GET /api/public-config` — the *non-secret* Firebase web config (apiKey, projectId,
   etc.) and the gate id, which the browser needs client-side but which aren't sensitive the way
   the service-account keys are.
3. Serves the two static frontends: `/staff/*` → `public/staff/`, `/admin/*` → `public/admin/`.
4. On startup: calls `sheets.ensureSheetsExist()` (creates the Sheet tabs/headers if missing) and
   `reminders.start()` (arms the in-process cron), then starts listening.

### 4.2 `src/config.js`

Single place that reads every environment variable (via `dotenv`) and applies defaults — gate
coordinates/radius, Sheets file path, Firebase settings, admin password, reminder thresholds,
`JOBS_SECRET`, and the fixed list of 4 staff categories. Every other module reads config from here
rather than touching `process.env` directly.

### 4.3 `src/sheets.js` — the only thing that talks to Google Sheets

Wraps the `googleapis` Sheets client. Key behaviors:
- **Auth**: a Google service account (`GOOGLE_SERVICE_ACCOUNT_KEY_FILE`) with edit access to the
  Sheet — no OAuth login flow, no user interaction needed.
- **Reads are cached** for 20 seconds in memory (`cache.staff`, `cache.logs`) to avoid hammering
  the Sheets API when the dashboard polls or multiple requests land close together. Any write
  (`appendStaff`, `appendLog`, `updateStaffFcmToken`, `setLogNote`) immediately invalidates the
  relevant cache so the next read is fresh.
- **Rows are plain objects**, converted via `rowsToObjects()` using the header row as keys — the
  rest of the app never deals with raw spreadsheet ranges/indices.
- `findRowIndex()` + `updateCell()` are the only way to *modify* an existing row (Sheets API has no
  "update by ID" — you have to find the row number first, then write to that specific cell).
- Exported functions used by the rest of the app: `getAllStaff`, `getStaffById`, `appendStaff`,
  `updateStaffFcmToken`, `getAllLogs`, `getLogsForStaff`, `getLatestLogForStaff`, `appendLog`,
  `setLogNote`.

### 4.4 `src/push.js` — the only thing that talks to Firebase

Thin wrapper around `firebase-admin`. `sendPush(token, title, body, data)` sends one FCM message;
if Firebase isn't configured (no service account file present) or the token is missing, it logs a
warning and returns `false` instead of throwing — callers treat a failed/skipped push as a normal,
non-fatal outcome (the attendance log entry is still the source of truth either way).

### 4.5 `src/utils/geo.js`

One pure function, `distanceMeters(lat1, lng1, lat2, lng2)` — standard Haversine great-circle
distance in meters. Used to check a scan is within `GATE_RADIUS_M` of the configured gate.

### 4.6 Routes (`src/routes/`) — the HTTP API

**`staff.js`**
- `GET /categories` — returns the 4 fixed role options, so the frontend dropdown never hardcodes
  them (one source of truth: `config.categories`).
- `POST /register` — creates a new Staff row with a fresh UUID. No login; this UUID, once handed
  back to the browser, *is* the staff member's identity from then on.
- `GET /:id` — current status for one staff member (used by the staff home page).
- `POST /:id/fcm-token` — saves/overwrites the browser's push token against that staff row.

**`attendance.js`** — the core state machine
- `POST /scan { staffId, gateId, lat, lng }`: looks up the staff member, checks `gateId` matches
  the configured gate, computes distance via `geo.js` and rejects (403) if outside
  `GATE_RADIUS_M`. Then calls `getLatestLogForStaff` — if their last entry was `CheckIn`, this scan
  becomes a `CheckOut`; otherwise (no entry, or last was `CheckOut`) it becomes a `CheckIn`. This
  single branch is what enforces "no checkout without a check-in" — there's no separate validation
  rule for it, it falls out of the state machine automatically.
- `POST /:staffId/extend`: "still on duty" action from a reminder notification. Only valid if there
  *is* an open session; sets `Note` to now+2h so the 8-hour reminder sweep leaves them alone for a
  while. Deliberately does **not** check them out — an actual checkout still requires a real gate
  scan + geofence pass, so this can't be used to fake leaving.

**`dashboard.js`** — admin-only, gated by `requireAdminPassword` middleware (checks the
`x-admin-password` header, or a `?password=` query param, against `config.adminPassword`)
- `GET /today`: joins `Staff` + `AttendanceLog` in memory to build one row per staff member —
  current status, last event, how many hours their session has been open, and an `overdue` flag
  (open 8+ hours, or it's past the night-cutoff hour).
- `GET /logs?date=&category=`: the raw log, newest first, optionally filtered.

**`jobs.js`** — machine-to-machine, gated by a shared secret (`x-jobs-secret` header vs
`config.jobsSecret`), *not* the admin password (this is meant to be called by an external
scheduler, not a human)
- `POST /trigger`: runs both reminder sweeps right now. This exists because a free-tier host can
  put the Node process to sleep, which would silently stop the in-process `node-cron` schedule from
  firing — an external pinger (cron-job.com) hits this every ~15 minutes instead, which both wakes
  the app and guarantees the checks run.
- `POST /test-push { staffId }`: sends one real push to one staff member immediately, bypassing the
  8h/10PM timing — used to verify the whole push pipeline (Firebase config → token → delivery)
  without waiting for the real thresholds.

### 4.7 `src/jobs/reminders.js` — the reminder logic

- `getOpenSessions()`: for every staff member, finds their latest log; returns only those whose
  latest entry is `CheckIn` (i.e., currently "inside").
- `run8HourSweep()`: for each open session, if it's been open ≥ `SHIFT_REMINDER_HOURS` and isn't
  currently snoozed (`Note` holds a future ISO timestamp), sends a push and snoozes further
  reminders for 2 hours.
- `runNightSweep()`: no-ops unless the current hour ≥ `NIGHT_CUTOFF_HOUR`. Sends a push to anyone
  still open who hasn't already gotten tonight's reminder (tracked via the `NIGHT:<date>` flag in
  `Note`), so it's safe to call this many times during the cutoff hour without spamming.
- `runAllSweeps()`: runs both — this is what `POST /api/jobs/trigger` calls, and also what the
  in-process `node-cron` schedule calls every 15 minutes as a (non-essential) convenience while the
  app happens to be awake.
- `start()`: arms the in-process `node-cron` job. Called once from `index.js` at boot.

### 4.8 `scripts/generate-qr.js`

Standalone CLI script (`npm run generate-qr -- <host> [gateId]`) — builds the exact check-in URL
(`<host>/staff/checkin.html?gate=<gateId>`) and renders it to `server/gate-qr-<gateId>.png` using
the `qrcode` package. This is the image printed and mounted at the physical gate.

## 5. Frontend — Staff PWA (`public/staff/`)

No build step — plain HTML/CSS/JS, loaded directly by the browser, installable to the phone's home
screen via `manifest.json`.

- **`app.js`** — shared helpers loaded by every staff page:
  - `Store`: thin `localStorage` wrapper holding `staffId`/`staffName`/`staffCategory` — this *is*
    the device's identity, there's no server-side session/cookie.
  - `api()`: fetch wrapper that throws on non-2xx with the server's error message.
  - `getLocation()`: promisifies `navigator.geolocation.getCurrentPosition`.
  - `setupPush(staffId)`: the push-notification registration flow — requests notification
    permission (as the very first step, to stay inside the user-gesture window Safari requires),
    then registers the service worker, initializes Firebase, fetches an FCM token, and saves it via
    `POST /api/staff/:id/fcm-token`. Returns `{ ok, reason }` instead of throwing, so callers can
    show *why* it failed (critical on iOS, which fails this silently and inconsistently).

- **`register.html`** — name + role dropdown (role options fetched from
  `GET /api/staff/categories`, never hardcoded in two places) + optional phone. On submit: calls
  `POST /api/staff/register`, saves the result into `Store`, attempts `setupPush()` and shows its
  result, then redirects to `checkin.html` (preserving the `?gate=` the user arrived with, if any).

- **`checkin.html`** — what the gate QR code actually points to. On load: redirects to
  `register.html` if `Store` has no staff ID yet; otherwise gets geolocation and calls
  `POST /api/attendance/scan`, showing the resulting Check-In/Check-Out badge or the geofence/error
  message. Has a "Try again" button for retries (e.g., after enabling location permission).

- **`index.html`** — the home screen icon's landing page. Shows the staff member's current status
  (fetched via `GET /api/staff/:id`) and an **"Enable push notifications" button** — deliberately a
  button rather than an automatic call, because iOS Safari only honors a notification-permission
  request made from inside a direct tap, not from code that runs on page load.

- **`manifest.json` / `icon.svg`** — PWA installability metadata ("Add to Home Screen").

- **`firebase-messaging-sw.js`** — the service worker. Handles two jobs: (1) standard PWA
  installability/offline-capability plumbing, and (2) receiving FCM push messages while the app is
  backgrounded/closed, via `firebase.messaging().onBackgroundMessage`, and showing them as a system
  notification. It's initialized with the Firebase config via `postMessage` from `app.js` rather
  than hardcoding it, so no Firebase keys are baked into the cached service worker file.

- **`styles.css`** — shared dark-mode-first mobile styling for all staff pages.

## 6. Frontend — Admin Dashboard (`public/admin/`)

- **`index.html`** — a password form, then (once authenticated) the roster table and a filterable
  log table. All in one page; no routing.
- **`admin.js`** — stores the entered password in `sessionStorage` (cleared when the tab closes)
  and sends it as the `x-admin-password` header on every `/api/dashboard/*` call; auto-logs-in on
  reload if a password is already stored and still valid. Renders the roster (`loadRoster()`) and
  the filterable log (`loadLogs()`, reacting to the date/category filter inputs) as plain HTML
  tables built from the API responses.
- **`styles.css`** — shared styling, matching the staff app's visual language.

## 7. End-to-end flow walkthroughs

**First-time check-in:**
`scan QR` → `checkin.html` loads → `Store` empty → redirect to `register.html?gate=main` →
fill form → `POST /api/staff/register` → `sheets.appendStaff()` → `Store.save()` →
`setupPush()` (best-effort) → redirect back to `checkin.html?gate=main` → `getLocation()` →
`POST /api/attendance/scan` → server checks distance via `geo.js`, finds no prior log → creates a
`CheckIn` row → page shows "Checked in".

**Returning check-out (same QR, any time later):**
`scan QR` → `checkin.html` loads → `Store` has `staffId` → `getLocation()` →
`POST /api/attendance/scan` → server finds latest log is `CheckIn` → creates a `CheckOut` row →
page shows "Checked out".

**Reminder delivery:**
`cron-job.com` → `POST /api/jobs/trigger` (every 15 min) → `runAllSweeps()` → `run8HourSweep()` +
`runNightSweep()` → for each qualifying open session, `push.sendPush()` → Firebase Cloud Messaging
→ staff's phone shows a system notification (even if the PWA isn't open) → tapping it opens
`checkin.html`, or the staff member can tap "still on duty" on the home page to call
`POST /api/attendance/:staffId/extend`.

**Admin viewing status:**
Open `/admin/` → enter password → `admin.js` calls `GET /api/dashboard/today` →
`dashboard.js` joins `getAllStaff()` + `getAllLogs()` in memory → returns one row per staff member
with derived status/overdue flags → rendered as a table.

## 8. Operational notes worth knowing

- **No database beyond the Google Sheet.** Every read hits (cached) Sheets API calls; this is
  intentional per the original requirement and fine at this scale, not built for high write volume.
- **No real authentication for staff** — identity is just a `localStorage`-held UUID. iOS
  additionally isolates storage between Safari tabs and a Home-Screen-installed copy of the same
  site, so the same person can end up with two different staff rows if they use both.
- **Render's free tier sleeps on inactivity**, which is *why* `/api/jobs/trigger` + the external
  `cron-job.com` schedule exist instead of relying solely on the in-process `node-cron` in
  `reminders.js`.
- **`.env` values containing `#` or spaces must be quoted** (dotenv treats a bare `#` as a comment
  start) — this bit us once with `ADMIN_PASSWORD` during setup.
- **Render's Secret Files use a bare filename**, not a path — Render mounts them under
  `/etc/secrets/<filename>` itself.
