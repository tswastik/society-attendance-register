const express = require('express');
const { v4: uuidv4 } = require('uuid');
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

// Admin-only override: logs a CheckIn/CheckOut without a geofence check, for fixing
// mistakes (e.g. someone forgot to scan out). Still enforces the same state-machine rule
// as a real gate scan — a check-out is only allowed if there's an open check-in, and a
// check-in is only allowed if there isn't already one open — so the log stays consistent.
async function forceLog(req, res, type) {
  try {
    const { staffId } = req.params;
    const staff = await sheets.getStaffById(staffId);
    if (!staff) return res.status(404).json({ error: 'Staff not found.' });

    const latest = await sheets.getLatestLogForStaff(staffId);
    const isOpenSession = !!latest && latest.Type === 'CheckIn';

    if (type === 'CheckOut' && !isOpenSession) {
      return res.status(400).json({ error: `${staff.Name} is not checked in, so there is nothing to check out.` });
    }
    if (type === 'CheckIn' && isOpenSession) {
      return res.status(400).json({ error: `${staff.Name} is already checked in.` });
    }

    await sheets.appendLog({
      LogId: uuidv4(),
      StaffId: staffId,
      Name: staff.Name,
      Category: staff.Category,
      Type: type,
      Timestamp: new Date().toISOString(),
      Lat: '',
      Lng: '',
      DistanceMeters: '',
      GateId: config.gate.id,
      Note: 'AdminForced',
    });

    res.json({ ok: true, type, message: `${staff.Name} forced ${type === 'CheckIn' ? 'checked in' : 'checked out'}.` });
  } catch (err) {
    console.error(`[dashboard.force-${type}] `, err);
    res.status(500).json({ error: 'Could not record forced attendance.' });
  }
}

router.post('/:staffId/force-checkin', (req, res) => forceLog(req, res, 'CheckIn'));
router.post('/:staffId/force-checkout', (req, res) => forceLog(req, res, 'CheckOut'));

module.exports = router;
