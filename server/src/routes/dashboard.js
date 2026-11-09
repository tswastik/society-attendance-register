const express = require('express');
const sheets = require('../sheets');
const config = require('../config');

const router = express.Router();

function requireAdminPassword(req, res, next) {
  const password = req.header('x-admin-password') || req.query.password;
  if (password !== config.adminPassword) {
    return res.status(401).json({ error: 'Invalid admin password.' });
  }
  next();
}

router.use(requireAdminPassword);

// GET /api/dashboard/today — current status of every registered staff member.
router.get('/today', async (req, res) => {
  try {
    const [staff, logs] = await Promise.all([sheets.getAllStaff(), sheets.getAllLogs()]);

    const now = Date.now();
    const roster = staff.map((s) => {
      const theirLogs = logs.filter((l) => l.StaffId === s.StaffId);
      const latest = theirLogs.reduce(
        (best, cur) => (!best || new Date(cur.Timestamp) > new Date(best.Timestamp) ? cur : best),
        null
      );

      const isCheckedIn = !!latest && latest.Type === 'CheckIn';
      let hoursOpen = null;
      let overdue = false;
      if (isCheckedIn) {
        hoursOpen = (now - new Date(latest.Timestamp).getTime()) / 3600000;
        overdue = hoursOpen >= config.shiftReminderHours || new Date().getHours() >= config.nightCutoffHour;
      }

      return {
        staffId: s.StaffId,
        name: s.Name,
        category: s.Category,
        isCheckedIn,
        lastEventType: latest ? latest.Type : null,
        lastEventTime: latest ? latest.Timestamp : null,
        hoursOpen: hoursOpen !== null ? Math.round(hoursOpen * 10) / 10 : null,
        overdue,
      };
    });

    res.json({ roster, gate: config.gate });
  } catch (err) {
    console.error('[dashboard.today] ', err);
    res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

// GET /api/dashboard/logs?date=YYYY-MM-DD&category=...
router.get('/logs', async (req, res) => {
  try {
    const { date, category } = req.query;
    let logs = await sheets.getAllLogs();

    if (date) {
      logs = logs.filter((l) => l.Timestamp && l.Timestamp.startsWith(date));
    }
    if (category) {
      logs = logs.filter((l) => l.Category === category);
    }

    logs = logs.slice().sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
    res.json({ logs });
  } catch (err) {
    console.error('[dashboard.logs] ', err);
    res.status(500).json({ error: 'Could not load logs.' });
  }
});

module.exports = router;
