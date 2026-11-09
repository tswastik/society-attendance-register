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
