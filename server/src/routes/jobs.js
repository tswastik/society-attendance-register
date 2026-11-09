const express = require('express');
const config = require('../config');
const reminders = require('../jobs/reminders');

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

module.exports = router;
