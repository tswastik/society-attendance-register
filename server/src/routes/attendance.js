const express = require('express');
const { v4: uuidv4 } = require('uuid');
const sheets = require('../sheets');
const config = require('../config');
const { distanceMeters } = require('../utils/geo');

const router = express.Router();

// POST /api/attendance/scan { staffId, gateId, lat, lng }
// Decides CheckIn vs CheckOut based on the staff member's current open-session state.
router.post('/scan', async (req, res) => {
  try {
    const { staffId, gateId, lat, lng } = req.body;
    if (!staffId || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'staffId, lat and lng are required.' });
    }

    const staff = await sheets.getStaffById(staffId);
    if (!staff) return res.status(404).json({ error: 'Staff not registered. Please register first.' });

    if (gateId && gateId !== config.gate.id) {
      return res.status(400).json({ error: 'Unknown gate.' });
    }

    const distance = distanceMeters(parseFloat(lat), parseFloat(lng), config.gate.lat, config.gate.lng);
    if (distance > config.gate.radiusMeters) {
      return res.status(403).json({
        error: `You appear to be ${Math.round(distance)}m from the gate. Move closer (within ${config.gate.radiusMeters}m) and try again.`,
        distanceMeters: Math.round(distance),
      });
    }

    const latestLog = await sheets.getLatestLogForStaff(staffId);
    const isOpenSession = !!latestLog && latestLog.Type === 'CheckIn';
    const type = isOpenSession ? 'CheckOut' : 'CheckIn';

    const logId = uuidv4();
    await sheets.appendLog({
      LogId: logId,
      StaffId: staffId,
      Name: staff.Name,
      Category: staff.Category,
      Type: type,
      Timestamp: new Date().toISOString(),
      Lat: lat,
      Lng: lng,
      DistanceMeters: Math.round(distance),
      GateId: config.gate.id,
      Note: '',
    });

    res.json({
      type,
      message: type === 'CheckIn' ? `Checked in, ${staff.Name}.` : `Checked out, ${staff.Name}.`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[attendance.scan] ', err);
    res.status(500).json({ error: 'Could not record attendance. Please try again.' });
  }
});

// POST /api/attendance/:staffId/extend
// Staff taps "Still on duty" from a reminder push: snoozes further reminders for a
// couple of hours. Does NOT check them out/in — an actual check-out still requires
// a real gate scan + geofence check.
router.post('/:staffId/extend', async (req, res) => {
  try {
    const { staffId } = req.params;
    const latestLog = await sheets.getLatestLogForStaff(staffId);
    if (!latestLog || latestLog.Type !== 'CheckIn') {
      return res.status(400).json({ error: 'No open shift found to extend.' });
    }
    const snoozeUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await sheets.setLogNote(latestLog.LogId, snoozeUntil);
    res.json({ ok: true, message: 'Thanks — we will remind you again later if you are still checked in.' });
  } catch (err) {
    console.error('[attendance.extend] ', err);
    res.status(500).json({ error: 'Could not extend shift.' });
  }
});

module.exports = router;
