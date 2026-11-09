const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const sheets = require('./sheets');
const reminders = require('./jobs/reminders');

const staffRoutes = require('./routes/staff');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');
const jobsRoutes = require('./routes/jobs');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/staff', staffRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/jobs', jobsRoutes);

// Expose a few non-secret config values the frontend needs (gate id, Firebase web config).
app.get('/api/public-config', (req, res) => {
  res.json({
    gateId: config.gate.id,
    firebase: {
      apiKey: config.firebase.apiKey,
      projectId: config.firebase.projectId,
      messagingSenderId: config.firebase.messagingSenderId,
      appId: config.firebase.appId,
      vapidKey: config.firebase.vapidKey,
    },
  });
});

// Served dynamically (not as a static file) because it needs the real Firebase config baked in
// directly — a service worker can be killed and restarted by the browser at any time with no page
// around to hand it config via postMessage, so it must be self-sufficient from the first line.
// These Firebase web values are public by design (same ones /api/public-config already exposes),
// not secrets, so embedding them in a JS file served to the client is fine.
app.get('/staff/firebase-messaging-sw.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify({
  apiKey: config.firebase.apiKey,
  projectId: config.firebase.projectId,
  messagingSenderId: config.firebase.messagingSenderId,
  appId: config.firebase.appId,
})});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Attendance reminder', {
    body: body || '',
    icon: '/staff/icon.svg',
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/staff/index.html';
  event.waitUntil(self.clients.openWindow(link));
});
`.trim());
});

app.use('/staff', express.static(path.join(__dirname, '..', '..', 'public', 'staff')));
app.use('/admin', express.static(path.join(__dirname, '..', '..', 'public', 'admin')));

app.get('/', (req, res) => res.redirect('/staff/index.html'));

async function main() {
  try {
    await sheets.ensureSheetsExist();
    console.log('[startup] Google Sheet tabs verified/created.');
  } catch (err) {
    console.error('[startup] Could not verify Google Sheet. Check SHEET_ID and service account access.', err.message);
  }

  reminders.start();

  app.listen(config.port, () => {
    console.log(`[startup] Server listening on http://localhost:${config.port}`);
  });
}

main();
