const BASE_URL = 'http://localhost:3000';

// Global State
let state = {
    userId: localStorage.getItem('jdm_test_id') || '',
    token: localStorage.getItem('jdm_test_token') || '',
    apiKey: localStorage.getItem('jdm_test_apiKey') || '',
    role: 'N/A',
    introspection: null,
    activeContext: { container: '', table: '' }
};

// --- Initialization ---
function init() {
    updateIdentityUI();
    log('System initialized. Client ready.');
    if (state.userId && (state.token || state.apiKey)) {
        fetchIntrospect();
    }
}

// --- Navigation ---
function showView(viewId) {
    document.querySelectorAll('.content-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    // Find active nav item
    if (viewId === 'auth') document.querySelector('[onclick*="auth"]').classList.add('active');
    if (viewId === 'storage') document.getElementById('nav-storage').classList.add('active');
}

// --- API Helpers ---
async function api(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (state.userId) headers['x-user-id'] = state.userId;
    if (state.apiKey) headers['x-api-key'] = state.apiKey;
    if (state.token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }

    const start = Date.now();
    try {
        const response = await fetch(url, { ...options, headers });
        const duration = Date.now() - start;
        const data = await response.json().catch(() => ({}));

        logRequest(options.method || 'GET', path, response.status, duration, data);
        return { status: response.status, data };
    } catch (err) {
        log(`❌ Error: ${err.message}`);
        return { status: 500, data: { error: err.message } };
    }
}

// --- Auth Actions ---
async function handleRegister() {
    const { status, data } = await api('/auth/register', { method: 'POST' });
    if (status === 201) {
        state.userId = data['x-user-id'];
        localStorage.setItem('jdm_test_id', state.userId);
        updateIdentityUI();
        log('Identity created successfully.');
    }
}

async function handleLogin() {
    const role = document.getElementById('login-role').value;
    const expiresIn = parseInt(document.getElementById('login-expires').value);

    const { status, data } = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ role, expiresIn })
    });

    if (status === 200) {
        state.token = data.token;
        state.role = data.role;
        localStorage.setItem('jdm_test_token', state.token);
        updateIdentityUI();
        fetchIntrospect();
    }
}

function saveConfig() {
    state.userId = document.getElementById('cfg-user-id').value;
    state.apiKey = document.getElementById('cfg-api-key').value;
    state.token = document.getElementById('cfg-token').value;

    localStorage.setItem('jdm_test_id', state.userId);
    localStorage.setItem('jdm_test_apiKey', state.apiKey);
    localStorage.setItem('jdm_test_token', state.token);

    updateIdentityUI();
    fetchIntrospect();
}

// --- Storage Actions ---
async function fetchIntrospect() {
    log('Fetching introspection...');
    const { status, data } = await api('/introspect');
    if (status === 200) {
        state.introspection = data;
        state.role = data.role;
        updateIdentityUI();
        renderStorage();
    }
}

function renderStorage() {
    const grid = document.getElementById('storage-grid');
    grid.innerHTML = '';

    const containers = Object.keys(state.introspection.storage);
    if (containers.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted)">No containers found. Create one below.</p>';
        return;
    }

    containers.forEach(name => {
        const tables = state.introspection.storage[name];
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-header">
                <h3>${name}</h3>
                <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem" onclick="deleteContainer('${name}')">Delete</button>
            </div>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                ${Object.keys(tables).map(t => `
                    <div class="nav-item" onclick="viewTable('${name}', '${t}')" style="justify-content:space-between; margin:0">
                        <span>${t}</span>
                        <span class="badge badge-get">${tables[t].count}</span>
                    </div>
                `).join('')}
            </div>
        `;
        grid.appendChild(card);
    });
}

async function createContainer() {
    const container = document.getElementById('new-container-name').value;
    const table = document.getElementById('new-container-table').value;

    if (!container || !table) return;

    await api(`/${container}/${table}`, {
        method: 'POST',
        body: JSON.stringify({ _init: true }) // Dummy data to create container/table
    });

    fetchIntrospect();
}

async function deleteContainer(name) {
    if (!confirm(`Delete container '${name}'?`)) return;
    await api(`/containers/${name}`, { method: 'DELETE' });
    fetchIntrospect();
}

// --- Table Data Actions ---
function viewTable(container, table) {
    state.activeContext = { container, table };
    document.getElementById('table-title').innerText = `Table: ${table}`;
    document.getElementById('table-subtitle').innerText = `Container: ${container}`;

    renderTable();
    showView('data');
}

function renderTable() {
    const { container, table } = state.activeContext;
    const dataObj = state.introspection.storage[container][table];
    const records = dataObj.data || [];

    const thead = document.getElementById('data-thead');
    const tbody = document.getElementById('data-tbody');

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="100" style="text-align:center">No records found.</td></tr>';
        return;
    }

    // Header
    const keys = Object.keys(records[0]);
    const tr = document.createElement('tr');
    keys.forEach(k => {
        const th = document.createElement('th');
        th.innerText = k;
        tr.appendChild(th);
    });
    const actionTh = document.createElement('th');
    actionTh.innerText = 'Actions';
    tr.appendChild(actionTh);
    thead.appendChild(tr);

    // Body
    records.forEach(row => {
        const tr = document.createElement('tr');
        keys.forEach(k => {
            const td = document.createElement('td');
            td.innerText = row[k];
            tr.appendChild(td);
        });
        const td = document.createElement('td');
        td.innerHTML = `
            <button class="btn btn-secondary" style="padding:4px 8px" onclick="deleteRecord('${row.id}')">Delete</button>
        `;
        tr.appendChild(td);
        tbody.appendChild(tr);
    });
}

// --- Modal/Form Logic ---
function openCreateModal() {
    const { container, table } = state.activeContext;
    const dataObj = state.introspection.storage[container][table];
    const preview = dataObj.schema_preview || [];

    const modal = document.getElementById('modal-container');
    const fields = document.getElementById('modal-fields');
    fields.innerHTML = '';

    // If we have a preview, use those fields. Otherwise just provide a JSON blob area or some defaults
    const cols = preview.length > 0 ? preview.filter(k => k !== 'id') : ['name', 'value'];

    cols.forEach(col => {
        fields.innerHTML += `
            <div class="form-group">
                <label>${col}</label>
                <input type="text" data-field="${col}" placeholder="Enter ${col}...">
            </div>
        `;
    });

    document.getElementById('modal-confirm').onclick = handleCreateRecord;
    modal.classList.remove('hidden');
}

async function handleCreateRecord() {
    const { container, table } = state.activeContext;
    const body = {};
    document.querySelectorAll('[data-field]').forEach(input => {
        body[input.dataset.field] = input.value;
    });

    const { status } = await api(`/${container}/${table}`, {
        method: 'POST',
        body: JSON.stringify(body)
    });

    if (status === 201) {
        closeModal();
        await fetchIntrospect();
        renderTable();
    }
}

async function deleteRecord(id) {
    const { container, table } = state.activeContext;
    await api(`/${container}/${table}/${id}`, { method: 'DELETE' });
    await fetchIntrospect();
    renderTable();
}

function closeModal() {
    document.getElementById('modal-container').classList.add('hidden');
}

// --- Identity UI ---
function updateIdentityUI() {
    document.getElementById('display-uuid').innerText = state.userId || 'None';
    document.getElementById('display-role').innerText = state.role || 'N/A';

    // Sync config inputs
    document.getElementById('cfg-user-id').value = state.userId;
    document.getElementById('cfg-api-key').value = state.apiKey;
    document.getElementById('cfg-token').value = state.token;
}

// --- Logging ---
function log(msg) {
    const logs = document.getElementById('logs');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span style="color:#94a3b8">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    logs.appendChild(entry);
    logs.scrollTop = logs.scrollHeight;
}

function logRequest(method, path, status, ms, data) {
    const logs = document.getElementById('logs');
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const statusClass = status >= 400 ? 'log-status-4xx' : 'log-status-2xx';
    const methodClass = `badge-${method.toLowerCase()}`;

    entry.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px">
            <span class="badge ${methodClass}">${method}</span>
            <span class="${statusClass}">${status}</span>
        </div>
        <div style="color:#94a3b8; margin-bottom:4px">${path} <span style="font-size:0.6rem">(${ms}ms)</span></div>
        <div style="color:#64748b; font-size:0.65rem; white-space:pre-wrap">${JSON.stringify(data, null, 2)}</div>
    `;
    logs.appendChild(entry);
    logs.scrollTop = logs.scrollHeight;
}

function clearLogs() {
    document.getElementById('logs').innerHTML = '';
}

// Entry point
window.onload = init;
