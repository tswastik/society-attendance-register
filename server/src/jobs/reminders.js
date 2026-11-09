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

// Daily at NIGHT_CUTOFF_HOUR (default 22:00): nag everyone still checked in.
async function runNightSweep() {
  const open = await getOpenSessions();
  for (const { staff, log } of open) {
    await push.sendPush(
      staff.FcmToken,
      "It's checkout time",
      `Hi ${staff.Name}, it's past ${config.nightCutoffHour}:00 and you're still checked in. Please check out, or let us know if you're still working.`,
      { link: '/staff/checkin.html', staffId: staff.StaffId }
    );
    await sheets.setLogNote(log.LogId, `OverdueAt${config.nightCutoffHour}:00`);
  }
}

function start() {
  // Every 15 minutes.
  cron.schedule('*/15 * * * *', () => {
    run8HourSweep().catch((err) => console.error('[jobs] 8h sweep failed:', err));
  });

  // Daily at the configured night cutoff hour, minute 0.
  cron.schedule(`0 ${config.nightCutoffHour} * * *`, () => {
    runNightSweep().catch((err) => console.error('[jobs] night sweep failed:', err));
  });

  console.log(`[jobs] Reminder jobs scheduled: 8h sweep every 15 min, night sweep daily at ${config.nightCutoffHour}:00.`);
}

module.exports = { start, run8HourSweep, runNightSweep };
