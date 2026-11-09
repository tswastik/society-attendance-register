const { google } = require('googleapis');
const config = require('./config');

const STAFF_SHEET = 'Staff';
const LOG_SHEET = 'AttendanceLog';

const STAFF_HEADERS = ['StaffId', 'Name', 'Category', 'Phone', 'FcmToken', 'RegisteredAt'];
const LOG_HEADERS = [
  'LogId', 'StaffId', 'Name', 'Category', 'Type', 'Timestamp',
  'Lat', 'Lng', 'DistanceMeters', 'GateId', 'Note',
];

let sheetsClient = null;
const CACHE_TTL_MS = 20000;
const cache = { staff: { rows: null, at: 0 }, logs: { rows: null, at: 0 } };

async function getClient() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.GoogleAuth({
    keyFile: config.serviceAccountKeyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function ensureSheetsExist() {
  const sheets = await getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheetId });
  const existingTitles = meta.data.sheets.map((s) => s.properties.title);

  const requests = [];
  if (!existingTitles.includes(STAFF_SHEET)) {
    requests.push({ addSheet: { properties: { title: STAFF_SHEET } } });
  }
  if (!existingTitles.includes(LOG_SHEET)) {
    requests.push({ addSheet: { properties: { title: LOG_SHEET } } });
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests } });
  }

  await writeHeaderIfMissing(STAFF_SHEET, STAFF_HEADERS);
  await writeHeaderIfMissing(LOG_SHEET, LOG_HEADERS);
}

async function writeHeaderIfMissing(sheetName, headers) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A1:Z1`,
  });
  const firstRow = res.data.values && res.data.values[0];
  if (!firstRow || firstRow.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

function rowsToObjects(headers, rows) {
  return (rows || []).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

async function readSheet(sheetName, headers, cacheKey) {
  const now = Date.now();
  if (cacheKey && cache[cacheKey].rows && now - cache[cacheKey].at < CACHE_TTL_MS) {
    return cache[cacheKey].rows;
  }
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A2:Z100000`,
  });
  const objects = rowsToObjects(headers, res.data.values);
  if (cacheKey) {
    cache[cacheKey] = { rows: objects, at: now };
  }
  return objects;
}

function invalidateCache(key) {
  if (key) cache[key] = { rows: null, at: 0 };
  else {
    cache.staff = { rows: null, at: 0 };
    cache.logs = { rows: null, at: 0 };
  }
}

async function appendRow(sheetName, headers, obj) {
  const sheets = await getClient();
  const row = headers.map((h) => (obj[h] !== undefined && obj[h] !== null ? obj[h] : ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// Finds the 1-based sheet row index (including header) of the row whose `idColumn` equals `idValue`.
async function findRowIndex(sheetName, idColumnIndex, idValue) {
  const sheets = await getClient();
  const colLetter = String.fromCharCode(65 + idColumnIndex);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!${colLetter}2:${colLetter}100000`,
  });
  const values = res.data.values || [];
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === idValue) return i + 2; // +2: 1-based + header row
  }
  return -1;
}

async function updateCell(sheetName, rowIndex, columnIndex, value) {
  const sheets = await getClient();
  const colLetter = String.fromCharCode(65 + columnIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!${colLetter}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

// --- Staff ---

async function getAllStaff() {
  return readSheet(STAFF_SHEET, STAFF_HEADERS, 'staff');
}

async function getStaffById(staffId) {
  const all = await getAllStaff();
  return all.find((s) => s.StaffId === staffId) || null;
}

async function appendStaff(staff) {
  await appendRow(STAFF_SHEET, STAFF_HEADERS, staff);
  invalidateCache('staff');
}

async function updateStaffFcmToken(staffId, token) {
  const rowIndex = await findRowIndex(STAFF_SHEET, 0, staffId);
  if (rowIndex === -1) throw new Error('Staff not found');
  await updateCell(STAFF_SHEET, rowIndex, STAFF_HEADERS.indexOf('FcmToken'), token);
  invalidateCache('staff');
}

// --- Attendance Log ---

async function getAllLogs() {
  return readSheet(LOG_SHEET, LOG_HEADERS, 'logs');
}

async function getLogsForStaff(staffId) {
  const all = await getAllLogs();
  return all.filter((l) => l.StaffId === staffId);
}

// Most recent log row for a staff member, or null if they have none yet.
async function getLatestLogForStaff(staffId) {
  const logs = await getLogsForStaff(staffId);
  if (logs.length === 0) return null;
  return logs.reduce((latest, cur) =>
    new Date(cur.Timestamp) > new Date(latest.Timestamp) ? cur : latest
  );
}

async function appendLog(log) {
  await appendRow(LOG_SHEET, LOG_HEADERS, log);
  invalidateCache('logs');
}

async function setLogNote(logId, note) {
  const rowIndex = await findRowIndex(LOG_SHEET, 0, logId);
  if (rowIndex === -1) throw new Error('Log not found');
  await updateCell(LOG_SHEET, rowIndex, LOG_HEADERS.indexOf('Note'), note);
  invalidateCache('logs');
}

module.exports = {
  ensureSheetsExist,
  getAllStaff,
  getStaffById,
  appendStaff,
  updateStaffFcmToken,
  getAllLogs,
  getLogsForStaff,
  getLatestLogForStaff,
  appendLog,
  setLogNote,
  invalidateCache,
};
