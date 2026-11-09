const express = require('express');
const { v4: uuidv4 } = require('uuid');
const sheets = require('../sheets');
const config = require('../config');

const router = express.Router();

router.get('/categories', (req, res) => {
  res.json({ categories: config.categories });
});

router.post('/register', async (req, res) => {
  try {
    const { name, category, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!config.categories.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${config.categories.join(', ')}` });
    }

    const staffId = uuidv4();
    await sheets.appendStaff({
      StaffId: staffId,
      Name: name.trim(),
      Category: category,
      Phone: phone || '',
      FcmToken: '',
      RegisteredAt: new Date().toISOString(),
    });

    res.json({ staffId, name: name.trim(), category });
  } catch (err) {
    console.error('[staff.register] ', err);
    res.status(500).json({ error: 'Could not register. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const staff = await sheets.getStaffById(req.params.id);
    if (!staff) return res.status(404).json({ error: 'Staff not found.' });

    const latestLog = await sheets.getLatestLogForStaff(req.params.id);
    const isCheckedIn = !!latestLog && latestLog.Type === 'CheckIn';

    res.json({
      staffId: staff.StaffId,
      name: staff.Name,
      category: staff.Category,
      isCheckedIn,
      lastEvent: latestLog ? { type: latestLog.Type, timestamp: latestLog.Timestamp } : null,
    });
  } catch (err) {
    console.error('[staff.get] ', err);
    res.status(500).json({ error: 'Could not load staff info.' });
  }
});

router.post('/:id/fcm-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required.' });
    const staff = await sheets.getStaffById(req.params.id);
    if (!staff) return res.status(404).json({ error: 'Staff not found.' });
    await sheets.updateStaffFcmToken(req.params.id, token);
    res.json({ ok: true });
  } catch (err) {
    console.error('[staff.fcm-token] ', err);
    res.status(500).json({ error: 'Could not save push token.' });
  }
});

module.exports = router;
