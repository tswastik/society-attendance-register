# Society Staff Attendance System

QR code + geolocation based check-in/check-out for House Keeping, Security Guard, Society Manager
and Other staff, backed by a Google Sheet, with push-notification reminders and a mobile-friendly
admin dashboard.

**Live deployment:** https://society-attendance-register.onrender.com
**Source:** https://github.com/tswastik/society-attendance-register

## How it works

1. Staff scan a single, static QR code posted at the gate with their phone's normal camera. It
   opens `https://<your-host>/staff/checkin.html?gate=main`.
2. First visit → they register (name + role dropdown). Their phone remembers them afterwards
   (no login/password for staff).
3. Each scan: the page reads the phone's GPS location and sends it to the server, which checks it
   is within the gate's geofence radius, then automatically logs a **Check-In** or **Check-Out**
   depending on whether they currently have an open session. Checkout is never possible without a
   prior check-in — the system always alternates CheckIn → CheckOut → CheckIn...
4. The server checks for anyone checked in 8+ hours, and anyone still checked in once the
   configured night-cutoff hour (default 10 PM) arrives, and sends them a push notification asking
   them to check out (or tap "still on duty" to snooze the reminder by 2 hours).
5. All data lives in a Google Sheet (`Staff` and `AttendanceLog` tabs), which the admin dashboard
   and server both read from.
6. The admin opens `https://<your-host>/admin/` on any phone or computer, enters the admin
   password, and sees today's roster (who's in/out, how long, overdue flags) and the full log.

## One-time setup

### 1. Google Sheet + service account (lets the server read/write the sheet)

1. Create a new Google Sheet. Copy its ID from the URL: `.../spreadsheets/d/<SHEET_ID>/edit`.
2. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or reuse one),
   enable the **Google Sheets API**, then create a **Service Account** and download its JSON key.
3. Open the Sheet, click **Share**, and share it with the service account's email
   (looks like `xxx@yyy.iam.gserviceaccount.com`) with **Editor** access.
4. Save the downloaded JSON key as `server/service-account.json` (or point
   `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` at wherever you put it).

The server creates the `Staff` and `AttendanceLog` tabs and headers automatically on first run if
they don't already exist.

### 2. Firebase project (for real push notifications)

1. Create a project at [Firebase Console](https://console.firebase.google.com/) (you can reuse the
   same Google Cloud project as step 1).
2. Project settings → Cloud Messaging → under "Web configuration", generate a **Web Push
   certificate (VAPID key)**.
3. Project settings → General → "Your apps" → add a **Web app** → copy the `apiKey`,
   `projectId`, `messagingSenderId`, and `appId` values.
4. Project settings → Service accounts → "Generate new private key" → save as
   `server/firebase-service-account.json`.
5. Fill all `FIREBASE_*` values into `server/.env` (copy from `.env.example`).

### 3. Gate location & radius

Drop a pin at the gate in Google Maps, right-click it to copy the lat/lng, and set `GATE_LAT`,
`GATE_LNG` in `server/.env`. `GATE_RADIUS_M` defaults to 75 meters (tune for GPS accuracy at your
gate — concrete/high-rise areas may need a larger radius).

### 4. Install & run locally

```bash
cd server
npm install
cp .env.example .env
# edit .env with your Sheet ID, gate coordinates, Firebase values, admin password, JOBS_SECRET
npm start
```

Open `http://localhost:3000/staff/index.html` and `http://localhost:3000/admin/` to test locally.
Geolocation works on `localhost` for local testing even without HTTPS; push notifications do not
(see the iOS note below) — testing push end-to-end requires a real HTTPS deployment.

> **`.env` gotcha:** if any value (e.g. `ADMIN_PASSWORD`) contains a `#` or spaces, wrap it in
> quotes (`ADMIN_PASSWORD="my#password"`) — otherwise the `#` is parsed as a comment and everything
> after it is silently dropped.

### 5. Deploy (this project is deployed on Render)

Push notifications and geolocation on a real phone require a real HTTPS domain (not plain HTTP).
This project is deployed to [Render](https://render.com)'s free tier, connected to the GitHub repo:

- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment variables:** every value from `.env` *except* the two `*_KEY_FILE` paths (see
  below), entered as plain key/value pairs (no quoting needed in Render's own UI).
- **Secret Files** (Environment tab → Secret Files): add two, using the **bare filename only**
  (Render mounts them under `/etc/secrets/` automatically — don't include a path):
  - filename `service-account.json` → paste the contents of your local `server/service-account.json`
  - filename `firebase-service-account.json` → paste the contents of your local `server/firebase-service-account.json`
  - then set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/etc/secrets/service-account.json` and
    `FIREBASE_SERVICE_ACCOUNT_KEY_FILE=/etc/secrets/firebase-service-account.json` as env vars.

Any other Node host (Railway, Fly.io, etc.) works the same way conceptually.

#### Reminder reliability on a free-tier host

Render's free tier **sleeps the app after ~15 minutes of no traffic**, which would silently stop
the in-process `node-cron` reminder jobs from firing (a sleeping process fires no timers). To work
around this, `POST /api/jobs/trigger` (guarded by the `JOBS_SECRET` env var, sent as the
`x-jobs-secret` header) runs the reminder sweeps on demand. This project uses a free external
scheduler, [cron-job.com](https://console.cron-job.com/), configured to `POST` that URL with the
`x-jobs-secret` header every 15 minutes — this both wakes the app and guarantees the checks
actually run, instead of depending on the host happening to be awake at the right moment.

There's also `POST /api/jobs/test-push` (same `x-jobs-secret` header, body `{"staffId": "..."}`)
for manually sending an immediate test reminder to one staff member, bypassing the normal 8h/10PM
timing — useful for verifying push works end-to-end without waiting for the real thresholds.

### 6. Generate and print the gate QR code

```bash
cd server
npm run generate-qr -- https://society-attendance-register.onrender.com main
```

This saves `server/gate-qr-main.png` — print it and mount it at the gate.

## Project structure

```
server/            Node.js + Express backend
  src/
    index.js         app entry point
    config.js         env/config loader
    sheets.js          Google Sheets API wrapper (Staff + AttendanceLog tabs)
    push.js             Firebase Admin push notification helper
    utils/geo.js        distance calculation for the geofence check
    routes/
      staff.js            register, lookup, save FCM token
      attendance.js        the gate scan (CheckIn/CheckOut) + "still on duty" extend
      dashboard.js          admin roster + log APIs (password-protected)
      jobs.js               external reminder trigger + manual test-push (JOBS_SECRET-protected)
    jobs/reminders.js    the 8-hour and night-cutoff reminder sweep logic
  scripts/generate-qr.js  prints the gate QR code PNG
public/
  staff/            the installable staff PWA (register, check-in, push setup)
  admin/            the password-gated admin dashboard page
```

## Known limitations

- **Staff identity is device-based, not a real login.** A staff member is recognized by a
  random ID saved in their phone's browser storage. If they clear browser data or switch phones,
  they must register again (and would appear as a new/duplicate staff row in the Sheet). On iOS
  specifically, a Home Screen–installed copy of the app has **separate storage from Safari** —
  registering in a Safari tab and then opening the Home Screen icon looks like a brand-new device
  and prompts registration again.
- **Google Sheets is the only datastore.** This is intentional (per the requirement that data
  live in a Sheet), and is fine at the scale of a few dozen staff and light daily scan volume, but
  it is not built for high write throughput.
- **Push notifications require the staff member to grant notification permission first.** On
  Android Chrome this can happen automatically after registering. **On iOS Safari, web push only
  works if the site has been "Added to Home Screen"** (iOS 16.4+) and opened from that Home Screen
  icon — a regular Safari tab cannot request notification permission at all. From the Home Screen
  app, use the **"Enable push notifications" button** on the home page (`/staff/index.html`) — the
  permission prompt must be requested from a direct tap, so it isn't requested automatically on
  page load.
- **Render's free tier sleeps on inactivity**, which is why reminder delivery depends on the
  external `cron-job.com` pinger described above rather than only the in-process scheduler. The
  first request after a quiet period can also take 30-50s (cold start).
