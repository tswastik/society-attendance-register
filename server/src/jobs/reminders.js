const cron = require('node-cron');
const sheets = require('../sheets');
const push = require('../push');
const config = require('../config');

// A log's Note holds either '' or an ISO timestamp meaning "don't nag again until this time".
function isSnoozed(note) {
  if (!note) return false;
  const until = new Date(note).getTime();
  return !Number.isNaN(until) && until > Date.now();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getOpenSessions() {
  const [staff, logs] = await Promise.all([sheets.getAllStaff(), sheets.getAllLogs()]);
  const byStaff = new Map(staff.map((s) => [s.StaffId, s]));

  const latestByStaff = new Map();
  for (const log of logs) {
    const existing = latestByStaff.get(log.StaffId);
    if (!existing || new Date(log.Timestamp) > new Date(existing.Timestamp)) {
      latestByStaff.set(log.StaffId, log);
    }
  }

  const open = [];
  for (const [staffId, log] of latestByStaff) {
    if (log.Type === 'CheckIn') {
      const s = byStaff.get(staffId);
      if (s) open.push({ staff: s, log });
    }
  }
  return open;
}

// Every 15 minutes: nag anyone whose shift has been open >= SHIFT_REMINDER_HOURS.
async function run8HourSweep() {
  const open = await getOpenSessions();
  const now = Date.now();

  for (const { staff, log } of open) {
    const hoursOpen = (now - new Date(log.Timestamp).getTime()) / 3600000;
    if (hoursOpen < config.shiftReminderHours) continue;
    if (isSnoozed(log.Note)) continue;

    const sent = await push.sendPush(
      staff.FcmToken,
      'Time to check out?',
      `Hi ${staff.Name}, your shift started ${hoursOpen.toFixed(1)}h ago. Please check out at the gate, or tap if you're still on duty.`,
      { link: '/staff/checkin.html', staffId: staff.StaffId }
    );
    if (sent) {
      const snoozeUntil = new Date(now + 2 * 60 * 60 * 1000).toISOString();
      await sheets.setLogNote(log.LogId, snoozeUntil);
    }
  }
}

// Nags everyone still checked in once the night cutoff hour has arrived, once per day.
// Safe to call as often as you like (e.g. every 15 min from an external pinger) — it
// only actually sends during the cutoff hour, and only once per staff member per day,
// tracked via a dated flag in the log's Note.
async function runNightSweep() {
  if (new Date().getHours() < config.nightCutoffHour) return;

  const flag = `NIGHT:${todayStr()}`;
  const open = await getOpenSessions();
  for (const { staff, log } of open) {
    if (log.Note === flag) continue; // already sent tonight

    await push.sendPush(
      staff.FcmToken,
      "It's checkout time",
      `Hi ${staff.Name}, it's past ${config.nightCutoffHour}:00 and you're still checked in. Please check out, or let us know if you're still working.`,
      { link: '/staff/checkin.html', staffId: staff.StaffId }
    );
    await sheets.setLogNote(log.LogId, flag);
  }
}

// Runs both sweeps. Safe to call repeatedly/externally — each sweep is idempotent
// within its own cooldown window. This is what a keep-alive-free external scheduler
// (e.g. cron-job.com hitting POST /api/jobs/trigger) should call every ~15 minutes,
// since a free Render instance can go to sleep and silently stop firing in-process cron.
async function runAllSweeps() {
  await run8HourSweep();
  await runNightSweep();
}

function start() {
  // In-process schedule: a nice-to-have while the instance happens to be awake.
  // Not relied upon alone — see runAllSweeps()/the /api/jobs/trigger endpoint.
  cron.schedule('*/15 * * * *', () => {
    runAllSweeps().catch((err) => console.error('[jobs] sweep failed:', err));
  });

  console.log('[jobs] Reminder sweeps scheduled every 15 min (in-process) and available via POST /api/jobs/trigger for external scheduling.');
}

module.exports = { start, run8HourSweep, runNightSweep, runAllSweeps };
