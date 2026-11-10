function getPassword() {
  return sessionStorage.getItem('adminPassword') || '';
}

async function adminApi(path, options = {}) {
  const res = await fetch(`/api/dashboard${path}`, {
    method: options.method || 'GET',
    headers: { 'x-admin-password': getPassword(), 'Content-Type': 'application/json' },
    body: options.body,
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
      const forceBtn = r.isCheckedIn
        ? `<button class="secondary force-btn" data-staff="${r.staffId}" data-type="force-checkout">Force check-out</button>`
        : `<button class="secondary force-btn" data-staff="${r.staffId}" data-type="force-checkin">Force check-in</button>`;
      return `<tr>
        <td>${r.name}</td>
        <td>${r.category}</td>
        <td>${statusBadge} ${overdue}</td>
        <td>${r.lastEventType || '—'}<br><span class="muted">${fmtTime(r.lastEventTime)}</span></td>
        <td>${r.hoursOpen !== null ? r.hoursOpen + 'h' : '—'}</td>
        <td>${forceBtn}</td>
      </tr>`;
    }).join('');

    box.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last event</th><th>Open for</th><th>Override</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    box.querySelectorAll('.force-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const staffId = btn.dataset.staff;
        const type = btn.dataset.type; // "force-checkin" or "force-checkout"
        const label = type === 'force-checkin' ? 'check this person IN' : 'check this person OUT';
        if (!confirm(`Force ${label}? This skips the gate location check.`)) return;

        btn.disabled = true;
        try {
          const result = await adminApi(`/${staffId}/${type}`, { method: 'POST' });
          alert(result.message);
          loadRoster();
          loadLogs();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      });
    });
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

    const rows = logs.map((l) => {
      const distance = l.DistanceMeters !== '' ? `${l.DistanceMeters}m` : '—';
      const forced = l.Note === 'AdminForced' ? ' <span class="muted">(admin override)</span>' : '';
      return `<tr>
        <td>${l.Name}</td>
        <td>${l.Category}</td>
        <td>${l.Type}${forced}</td>
        <td>${fmtTime(l.Timestamp)}</td>
        <td>${distance}</td>
      </tr>`;
    }).join('');

    box.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Type</th><th>Time</th><th>Distance</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
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
