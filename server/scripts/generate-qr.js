// Generates the printable gate QR code.
// Usage: npm run generate-qr -- https://your-deployed-host.com main
const QRCode = require('qrcode');
const path = require('path');

const host = process.argv[2];
const gateId = process.argv[3] || 'main';

if (!host) {
  console.error('Usage: npm run generate-qr -- <https://your-host> [gateId]');
  process.exit(1);
}

const url = `${host.replace(/\/$/, '')}/staff/checkin.html?gate=${encodeURIComponent(gateId)}`;
const outFile = path.join(__dirname, '..', `gate-qr-${gateId}.png`);

QRCode.toFile(outFile, url, { width: 800, margin: 2 }, (err) => {
  if (err) {
    console.error('Failed to generate QR code:', err);
    process.exit(1);
  }
  console.log(`QR code for "${url}" saved to ${outFile}`);
});
