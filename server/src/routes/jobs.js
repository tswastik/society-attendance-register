const express = require('express');
const config = require('../config');
const reminders = require('../jobs/reminders');
const sheets = require('../sheets');
const push = require('../push');

const router = express.Router();

// POST /api/jobs/trigger — runs the reminder sweeps on demand.
// Intended to be called by an external scheduler (e.g. cron-job.com) every ~15 minutes,
// since a free-tier host can sleep the app and silently stop its in-process cron.
// Protected by a shared secret rather than the admin password, since this is meant to be
// called machine-to-machine on a schedule.
router.post('/trigger', async (req, res) => {
  const secret = req.header('x-jobs-secret');
  if (!config.jobsSecret || secret !== config.jobsSecret) {
    return res.status(401).json({ error: 'Invalid or missing jobs secret.' });
  }

  try {
    await reminders.runAllSweeps();
    res.json({ ok: true, ranAt: new Date().toISOString() });
  } catch (err) {
    console.error('[jobs.trigger] ', err);
    res.status(500).json({ error: 'Sweep failed.' });
  }
});

// POST /api/jobs/test-push { staffId } — sends an immediate "please check out" push to one
// staff member, bypassing the 8h/10PM time checks. For manually verifying push notifications
// work end-to-end without waiting for the real thresholds to pass.
router.post('/test-push', async (req, res) => {
  const secret = req.header('x-jobs-secret');
  if (!config.jobsSecret || secret !== config.jobsSecret) {
    return res.status(401).json({ error: 'Invalid or missing jobs secret.' });
  }

  try {
    const { staffId } = req.body;
    const staff = await sheets.getStaffById(staffId);
    if (!staff) return res.status(404).json({ error: 'Staff not found.' });
    if (!staff.FcmToken) {
      return res.status(400).json({ error: 'This staff member has no push token on file yet (they need to open the app and allow notifications first).' });
    }

    const sent = await push.sendPush(
      staff.FcmToken,
      'Test: time to check out?',
      `Hi ${staff.Name}, this is a test reminder — please check out at the gate, or tap if you're still on duty.`,
      { link: '/staff/checkin.html', staffId: staff.StaffId }
    );

    res.json({ ok: sent, message: sent ? 'Push sent.' : 'Push was not sent (see server logs — likely Firebase not configured or token invalid).' });
  } catch (err) {
    console.error('[jobs.test-push] ', err);
    res.status(500).json({ error: 'Failed to send test push.' });
  }
});

module.exports = router;
