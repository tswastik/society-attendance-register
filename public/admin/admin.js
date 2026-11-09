function getPassword() {
  return sessionStorage.getItem('adminPassword') || '';
}

async function adminApi(path) {
  const res = await fetch(`/api/dashboard${path}`, {
    headers: { 'x-admin-password': getPassword() },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function tryLogin(password) {
  sessionStorage.setItem('adminPassword', password);
  await adminApi('/today'); // throws if password is wrong
}

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

async function loadRoster() {
  const box = document.getElementById('rosterBox');
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { roster } = await adminApi('/today');
    if (roster.length === 0) {
      box.innerHTML = '<p class="muted">No staff registered yet.</p>';
      return;
    }

    const rows = roster.map((r) => {
      const statusBadge = r.isCheckedIn
        ? `<span class="badge in">IN</span>`
        : `<span class="badge out">OUT</span>`;
      const overdue = r.overdue ? `<span class="badge overdue">OVERDUE</span>` : '';
      return `<tr>
        <td>${r.name}</td>
        <td>${r.category}</td>
        <td>${statusBadge} ${overdue}</td>
        <td>${r.lastEventType || '—'}<br><span class="muted">${fmtTime(r.lastEventTime)}</span></td>
        <td>${r.hoursOpen !== null ? r.hoursOpen + 'h' : '—'}</td>
      </tr>`;
    }).join('');

    box.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last event</th><th>Open for</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    box.innerHTML = `<p class="err">${err.message}</p>`;
  }
}

async function loadLogs() {
  const box = document.getElementById('logsBox');
  const date = document.getElementById('dateFilter').value;
  const category = document.getElementById('categoryFilter').value;
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (category) params.set('category', category);
    const { logs } = await adminApi(`/logs?${params.toString()}`);

    if (logs.length === 0) {
      box.innerHTML = '<p class="muted">No matching log entries.</p>';
      return;
    }

    const rows = logs.map((l) => `<tr>
      <td>${l.Name}</td>
      <td>${l.Category}</td>
      <td>${l.Type}</td>
      <td>${fmtTime(l.Timestamp)}</td>
      <td>${l.DistanceMeters}m</td>
    </tr>`).join('');

    box.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Type</th><th>Time</th><th>Distance</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    box.innerHTML = `<p class="err">${err.message}</p>`;
  }
}

function showDashboard() {
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadRoster();
  loadLogs();
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const errBox = document.getElementById('loginErr');
  errBox.textContent = '';
  try {
    await tryLogin(password);
    showDashboard();
  } catch (err) {
    errBox.textContent = err.message;
  }
});

document.getElementById('refreshBtn').addEventListener('click', () => { loadRoster(); loadLogs(); });
document.getElementById('dateFilter').addEventListener('change', loadLogs);
document.getElementById('categoryFilter').addEventListener('change', loadLogs);

// If a password is already saved for this tab session, skip straight to the dashboard.
if (getPassword()) {
  tryLogin(getPassword()).then(showDashboard).catch(() => sessionStorage.removeItem('adminPassword'));
}
