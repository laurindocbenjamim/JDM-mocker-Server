const BASE_URL = ''; // Use relative paths for same-origin

let adminState = {
    token: localStorage.getItem('dev_token'),
    userId: localStorage.getItem('dev_userId')
};

async function handleDevLogin() {
    const email = document.getElementById('dev-email').value;
    const password = document.getElementById('dev-password').value;

    const response = await fetch(`${BASE_URL}/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (response.ok) {
        adminState.token = data.token;
        adminState.userId = data.userId;
        localStorage.setItem('dev_token', data.token);
        localStorage.setItem('dev_userId', data.userId);
        showDashboard();
    } else {
        alert(data.error || 'Login failed');
    }
}

function showDashboard() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    fetchStats();
}

async function fetchStats() {
    if (!adminState.token) return;

    const headers = { 'Authorization': `Bearer ${adminState.token}` };
    if (adminState.userId) headers['x-user-id'] = adminState.userId;

    const response = await fetch(`${BASE_URL}/admin/stats`, { headers });

    if (response.status === 401 || response.status === 403) {
        // Only logout if we definitely had a session that is now invalid
        if (adminState.token) logout();
        return;
    }

    const stats = await response.json();
    renderStats(stats);
}

function renderStats(stats) {
    if (!Array.isArray(stats)) return;
    const tbody = document.getElementById('stats-tbody');
    tbody.innerHTML = stats.map(s => `
        <tr>
            <td>
                <div style="font-weight:700">${s.name}</div>
                <div style="font-size:0.7rem; color:var(--admin-muted); font-family:'Fira Code'">${s.userId}</div>
                <div style="font-size:0.75rem; color:var(--admin-primary)">${s.email}</div>
            </td>
            <td><span class="stat-badge">${s.containerCount}</span></td>
            <td><span class="stat-badge">${s.tableCount}</span></td>
            <td style="font-size:0.8rem">${new Date(s.createdAt).toLocaleDateString()}</td>
            <td>
                ${s.userId !== 'dev-master-root' ? `
                    <button class="btn-remove" onclick="deleteUser('${s.userId}')">Remove User</button>
                ` : '<span style="color:var(--admin-primary); font-weight:800">Master Root</span>'}
            </td>
        </tr>
    `).join('');
}

async function deleteUser(id) {
    if (!confirm('Permanently wipe this user and all their data?')) return;

    const headers = { 'Authorization': `Bearer ${adminState.token}` };
    if (adminState.userId) headers['x-user-id'] = adminState.userId;

    const response = await fetch(`${BASE_URL}/admin/users/${id}`, {
        method: 'DELETE',
        headers
    });

    if (response.ok) {
        fetchStats();
    }
}

function logout() {
    localStorage.removeItem('dev_token');
    localStorage.removeItem('dev_userId');
    adminState.token = null;
    adminState.userId = null;
    window.location.reload();
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    if (adminState.token) {
        // Test the token silently before showing dashboard
        fetch(`${BASE_URL}/admin/stats`, {
            headers: { 'Authorization': `Bearer ${adminState.token}` }
        }).then(res => {
            if (res.ok) {
                showDashboard();
            } else {
                logout(); // Silently clear if stale
            }
        }).catch(() => logout());
    }
});
