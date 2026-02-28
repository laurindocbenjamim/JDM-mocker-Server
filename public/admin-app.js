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
        showToast(data.error || 'Login failed', 'error');
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

function renderStats(data) {
    if (!data) return;
    const stats = data.details || [];
    const summary = data.summary || { totalUsers: 0, totalContainers: 0, totalTables: 0, totalColumns: 0 };

    // Update summary cards
    if (document.getElementById('stat-users')) {
        document.getElementById('stat-users').innerText = summary.totalUsers;
        document.getElementById('stat-containers').innerText = summary.totalContainers;
        document.getElementById('stat-tables').innerText = summary.totalTables;
        document.getElementById('stat-columns').innerText = summary.totalColumns;
    }

    const tbody = document.getElementById('stats-tbody');
    tbody.innerHTML = stats.map(s => `
        <tr data-user-id="${s.userId}">
            <td>
                ${s.userId !== 'dev-master-root' ? `
                    <input type="checkbox" class="selection-checkbox row-checkbox" 
                        onchange="updateActionBar()" value="${s.userId}">
                ` : ''}
            </td>
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
                    <button class="btn-remove" onclick="deleteUser('${s.userId}', event)">Remove User</button>
                ` : '<span style="color:var(--admin-primary); font-weight:800">Master Root</span>'}
            </td>
        </tr>
    `).join('');
    updateActionBar();
}

async function deleteUser(id, e) {
    if (!confirm('Permanently wipe this user and all their data?')) return;

    // Optimistic UI: Find and remove the row immediately
    const btn = e ? e.target : event.target;
    const row = btn.closest('tr');
    if (row) {
        row.style.opacity = '0.5';
        row.style.pointerEvents = 'none';
        // Optional: transition out before removal
        setTimeout(() => row.remove(), 300);
    }

    try {
        const headers = { 'Authorization': `Bearer ${adminState.token}` };
        if (adminState.userId) headers['x-user-id'] = adminState.userId;

        const response = await fetch(`${BASE_URL}/admin/users/${id}`, {
            method: 'DELETE',
            headers
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.status === 404 ? 'Endpoint not found. Please restart the server.' : 'Unknown server error' }));
            showToast(`Failed (${response.status}): ${err.error}`, 'error');
            // On failure, we should probably fetchStats to restore the row
            await fetchStats();
        } else {
            showToast('User successfully removed', 'success');
            await fetchStats(); // Refresh totals
        }
    } catch (err) {
        showToast('Deletion failed', 'error');
        await fetchStats();
    }
}

function updateActionBar() {
    const checked = document.querySelectorAll('.row-checkbox:checked');
    const bar = document.getElementById('bulk-actions-bar');
    const count = document.getElementById('selection-count');

    if (checked.length > 0) {
        bar.classList.add('active');
        count.innerText = `${checked.length} users selected`;
    } else {
        bar.classList.remove('active');
        document.getElementById('select-all').checked = false;
    }
}

function toggleSelectAll(checked) {
    document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = checked;
    });
    updateActionBar();
}

function clearSelection() {
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('select-all').checked = false;
    updateActionBar();
}

async function deleteSelectedUsers() {
    const selected = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.value);
    if (selected.length === 0) return;
    if (!confirm(`Are you sure you want to PERMANENTLY delete these ${selected.length} users?`)) return;

    // Optimistic UI
    selected.forEach(id => {
        const row = document.querySelector(`tr[data-user-id="${id}"]`);
        if (row) {
            row.style.opacity = '0.5';
            row.style.pointerEvents = 'none';
            setTimeout(() => row.remove(), 300);
        }
    });
    document.getElementById('bulk-actions-bar').classList.remove('active');

    try {
        const headers = {
            'Authorization': `Bearer ${adminState.token}`,
            'Content-Type': 'application/json'
        };
        if (adminState.userId) headers['x-user-id'] = adminState.userId;

        const response = await fetch(`${BASE_URL}/admin/users/bulk-delete`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ userIds: selected })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.status === 404 ? 'Bulk endpoint not found. Please restart the server.' : 'Unknown server error' }));
            showToast(`Bulk deletion failed (${response.status}): ${err.error}`, 'error');
            await fetchStats();
        } else {
            showToast(`Successfully removed ${selected.length} users`, 'success');
            await fetchStats(); // Refresh totals
        }
    } catch (err) {
        showToast('Network error during bulk deletion', 'error');
        await fetchStats();
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = '✓';
    if (type === 'error') icon = '✕';
    if (type === 'warning') icon = '⚠';

    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
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
                // Add background polling to keep totals fresh
                setInterval(fetchStats, 30000);
            } else {
                logout(); // Silently clear if stale
            }
        }).catch(() => logout());
    }
});
