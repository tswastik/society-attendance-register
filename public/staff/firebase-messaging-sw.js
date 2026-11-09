// Service worker for the staff PWA: enables "Add to Home Screen" installability
// and receives FCM push notifications while the app is in the background/closed.
// Firebase config is injected at runtime via postMessage from app.js (no secrets live here).

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// app.js calls firebase.messaging() on the page itself for foreground messages;
// this file only needs a Firebase app initialized so background messages can be shown.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'INIT_FIREBASE' && !firebase.apps.length) {
    firebase.initializeApp(event.data.config);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const { title, body } = payload.notification || {};
      self.registration.showNotification(title || 'Attendance reminder', {
        body: body || '',
        icon: '/staff/icon.svg',
        data: payload.data || {},
      });
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/staff/index.html';
  event.waitUntil(self.clients.openWindow(link));
});
