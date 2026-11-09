# Society Staff Attendance System

QR code + geolocation based check-in/check-out for House Keeping, Security Guard, Society Manager
and Other staff, backed by a Google Sheet, with push-notification reminders and a mobile-friendly
admin dashboard.

## How it works

1. Staff scan a single, static QR code posted at the gate with their phone's normal camera. It
   opens `https://<your-host>/staff/checkin.html?gate=main`.
2. First visit → they register (name + role dropdown). Their phone remembers them afterwards
   (no login/password for staff).
3. Each scan: the page reads the phone's GPS location and sends it to the server, which checks it
   is within the gate's geofence radius, then automatically logs a **Check-In** or **Check-Out**
   depending on whether they currently have an open session. Checkout is never possible without a
   prior check-in — the system always alternates CheckIn → CheckOut → CheckIn...
4. Every 15 minutes the server checks for anyone checked in for 8+ hours, and every night at the
   configured hour (default 10 PM) it checks for anyone still checked in — both send a push
   notification asking them to check out (or tap "still on duty" to snooze the reminder).
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

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
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

### 4. Install & run

```bash
cd server
npm install
cp .env.example .env
# edit .env with your Sheet ID, gate coordinates, Firebase values, admin password
npm start
```

Open `http://localhost:3000/staff/index.html` and `http://localhost:3000/admin/` to test locally.
Geolocation and push notifications work on `localhost` for local testing even without HTTPS.

### 5. Deploy somewhere with HTTPS

Push notifications and geolocation on a real phone require a real HTTPS domain (not plain HTTP).
Deploy the `server/` app to any Node host (Render, Railway, Fly.io, etc. all have free tiers) —
point it at the same `.env` values (as environment variables / secrets on that platform) plus the
two JSON key files as secret files or env vars.

### 6. Generate and print the gate QR code

```bash
cd server
npm run generate-qr -- https://your-deployed-host.com main
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
    routes/             staff.js, attendance.js, dashboard.js (the HTTP API)
    jobs/reminders.js    the 8-hour and 10 PM cron reminder sweeps
  scripts/generate-qr.js  prints the gate QR code PNG
public/
  staff/            the installable staff PWA (register, check-in, push setup)
  admin/            the password-gated admin dashboard page
```

## Known limitations

- **Staff identity is device-based, not a real login.** A staff member is recognized by a
  random ID saved in their phone's browser storage. If they clear browser data or switch phones,
  they must register again (and would appear as a new/duplicate staff row in the Sheet).
- **Google Sheets is the only datastore.** This is intentional (per the requirement that data
  live in a Sheet), and is fine at the scale of a few dozen staff and light daily scan volume, but
  it is not built for high write throughput.
- **Push notifications require the staff member to open the check-in/home page at least once**
  (to grant notification permission and register their device token) before reminders can reach
  them.
