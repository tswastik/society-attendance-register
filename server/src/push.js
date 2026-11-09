const admin = require('firebase-admin');
const fs = require('fs');
const config = require('./config');

let initialized = false;

function init() {
  if (initialized) return;
  if (!fs.existsSync(config.firebase.serviceAccountKeyFile)) {
    console.warn('[push] Firebase service account key file not found — push notifications are disabled until it is configured.');
    return;
  }
  const serviceAccount = JSON.parse(fs.readFileSync(config.firebase.serviceAccountKeyFile, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  initialized = true;
}

async function sendPush(token, title, body, data = {}) {
  init();
  if (!initialized || !token) {
    console.warn(`[push] Skipped push "${title}" — Firebase not configured or token missing.`);
    return false;
  }
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data,
      webpush: {
        fcmOptions: { link: data.link || '/staff/index.html' },
      },
    });
    return true;
  } catch (err) {
    console.error('[push] Failed to send push notification:', err.message);
    return false;
  }
}

module.exports = { sendPush };
