require('dotenv').config();

function required(name, value) {
  if (!value) {
    console.warn(`[config] Warning: ${name} is not set. Related features will fail until it is configured.`);
  }
  return value;
}

module.exports = {
  port: process.env.PORT || 3000,

  sheetId: required('SHEET_ID', process.env.SHEET_ID),
  serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './service-account.json',

  gate: {
    id: process.env.GATE_ID || 'main',
    lat: parseFloat(process.env.GATE_LAT || '0'),
    lng: parseFloat(process.env.GATE_LNG || '0'),
    radiusMeters: parseFloat(process.env.GATE_RADIUS_M || '75'),
  },

  firebase: {
    serviceAccountKeyFile: process.env.FIREBASE_SERVICE_ACCOUNT_KEY_FILE || './firebase-service-account.json',
    vapidKey: process.env.FIREBASE_VAPID_KEY || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    apiKey: process.env.FIREBASE_API_KEY || '',
    appId: process.env.FIREBASE_APP_ID || '',
  },

  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  jobsSecret: process.env.JOBS_SECRET || '',

  shiftReminderHours: parseFloat(process.env.SHIFT_REMINDER_HOURS || '8'),
  nightCutoffHour: parseInt(process.env.NIGHT_CUTOFF_HOUR || '22', 10),

  categories: ['House Keeping', 'Security Guard', 'Society Manager', 'Others'],
};
