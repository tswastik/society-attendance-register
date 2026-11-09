// Shared helpers for the staff PWA pages.

const Store = {
  get staffId() { return localStorage.getItem('staffId'); },
  get name() { return localStorage.getItem('staffName'); },
  get category() { return localStorage.getItem('staffCategory'); },
  save({ staffId, name, category }) {
    localStorage.setItem('staffId', staffId);
    localStorage.setItem('staffName', name);
    localStorage.setItem('staffCategory', category);
  },
  isRegistered() { return !!this.staffId; },
};

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device/browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(`Could not get your location: ${err.message}. Please enable location access.`)),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

// Registers the service worker and, if permission is granted, fetches an FCM
// token and saves it against the staff record so push reminders can reach this device.
// Returns { ok, reason } instead of throwing, so callers can show *why* it failed —
// Safari in particular fails this silently in ways that are otherwise invisible to debug.
async function setupPush(staffId) {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      return { ok: false, reason: 'Push notifications are not supported in this browser.' };
    }

    // Ask for permission FIRST, before any other async work. Safari can silently
    // ignore a permission request made too long after the user's tap/submit that
    // triggered this call, so we keep this as close to that gesture as possible.
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      return { ok: false, reason: `Notification permission was "${permission}".` };
    }

    const config = await api('/public-config');
    if (!config.firebase || !config.firebase.apiKey) {
      return { ok: false, reason: 'Push is not configured on the server yet.' };
    }

    const reg = await navigator.serviceWorker.register('/staff/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    reg.active && reg.active.postMessage({ type: 'INIT_FIREBASE', config: config.firebase });

    if (!window.firebase) {
      return { ok: false, reason: 'Firebase SDK script did not load on this page.' };
    }
    if (!firebase.apps.length) firebase.initializeApp(config.firebase);
    const messaging = firebase.messaging();
    const token = await messaging.getToken({
      vapidKey: config.firebase.vapidKey,
      serviceWorkerRegistration: reg,
    });
    if (!token) return { ok: false, reason: 'Firebase did not return a push token.' };

    if (staffId) {
      await api(`/staff/${staffId}/fcm-token`, { method: 'POST', body: JSON.stringify({ token }) });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
