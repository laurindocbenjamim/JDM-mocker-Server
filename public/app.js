const BASE_URL = ''; // Relative path for local/prod compatibility

// Global State
let state = {
    userId: localStorage.getItem('jdm_test_id') || '',
    token: localStorage.getItem('jdm_test_token') || '',
    apiKey: localStorage.getItem('jdm_test_apiKey') || '',
    role: 'N/A',
    introspection: null,
    activeContext: { container: '', table: '' },
    editingId: null
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

        if (response.status >= 400) {
            const errorMsg = data.error || response.statusText || 'Unknown Error';
            showToast(`${errorMsg}`, 'error');
        }

        return { status: response.status, data };
    } catch (err) {
        log(`❌ Error: ${err.message}`);
        showToast(`Network Error: ${err.message}`, 'error');
        return { status: 500, data: { error: err.message } };
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
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(0,0,0,0.05); font-size: 0.7rem;">${icon}</div>
            <span>${message}</span>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 6000);
}

function castValue(value, type) {
    if (value === null || value === undefined) return value;
    if (type === 'Boolean') {
        if (typeof value === 'boolean') return value;
        return value.toLowerCase() === 'true';
    }
    if (type === 'Number') return Number(value);
    if (type === 'Date') return new Date(value).toISOString();
    return value;
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
        showToast(`Welcome! Logged in as ${data.role}`);
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
                <div style="display:flex; gap:0.5rem">
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size:0.7rem" onclick="openCreateTableModal('${name}')">+ Table</button>
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem" onclick="deleteContainer('${name}')">Delete</button>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                ${Object.keys(tables).map(t => {
            const hasCustom = tables[t].customPaths && Object.keys(tables[t].customPaths).length > 0;
            return `
                        <div class="nav-item table-item" onclick="viewTable('${name}', '${t}')" style="justify-content:space-between; margin:0; position:relative; flex-wrap: wrap; height: auto; min-height: 48px;">
                            <div style="display:flex; flex-direction:column; gap:2px;">
                                <span>${t}</span>
                                ${hasCustom ? `
                                    <div style="font-size:0.6rem; color:var(--primary); font-weight:700; opacity:0.8">
                                        Custom: ${Object.keys(tables[t].customPaths).join(', ').toUpperCase()}
                                    </div>
                                ` : ''}
                            </div>
                            <div style="display:flex; align-items:center; gap:0.5rem">
                                <span class="badge badge-get">${tables[t].count}</span>
                                <button class="btn-icon-delete" onclick="event.stopPropagation(); deleteTable('${name}', '${t}')">×</button>
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
        grid.appendChild(card);
    });
}

function openCreateTableModal(container) {
    const modal = document.getElementById('modal-container');
    const fields = document.getElementById('modal-fields');
    document.getElementById('modal-title').innerText = `Create Table in ${container}`;
    fields.scrollTop = 0; // Reset scroll
    fields.innerHTML = `
        <div class="form-group">
            <label>Table Name</label>
            <input type="text" id="new-table-name" placeholder="e.g. orders">
        </div>
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
            <p style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                Custom Endpoints (Optional)
                <span style="font-weight: 400; font-size: 0.65rem; color: var(--primary); cursor: pointer;" onclick="document.getElementById('custom-endpoints-group').classList.toggle('hidden')">Show/Hide</span>
            </p>
            <div id="custom-endpoints-group" class="hidden">
                <div class="form-group" style="margin-bottom: 0.5rem;">
                    <label style="font-size: 0.65rem;">GET Path (e.g. /users/list)</label>
                    <input type="text" id="custom-path-get" placeholder="/none" style="font-size: 0.8rem; height: 32px;">
                </div>
                <div class="form-group" style="margin-bottom: 0.5rem;">
                    <label style="font-size: 0.65rem;">POST Path (e.g. /users/create)</label>
                    <input type="text" id="custom-path-post" placeholder="/none" style="font-size: 0.8rem; height: 32px;">
                </div>
                <div class="form-group" style="margin-bottom: 0.5rem;">
                    <label style="font-size: 0.65rem;">PUT Path</label>
                    <input type="text" id="custom-path-put" placeholder="/none" style="font-size: 0.8rem; height: 32px;">
                </div>
                <div class="form-group" style="margin-bottom: 0.5rem;">
                    <label style="font-size: 0.65rem;">DELETE Path</label>
                    <input type="text" id="custom-path-delete" placeholder="/none" style="font-size: 0.8rem; height: 32px;">
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal-confirm').onclick = async () => {
        const table = document.getElementById('new-table-name').value;
        if (!table) return;

        const _customPaths = {};
        const pGet = document.getElementById('custom-path-get').value;
        const pPost = document.getElementById('custom-path-post').value;
        const pPut = document.getElementById('custom-path-put').value;
        const pDelete = document.getElementById('custom-path-delete').value;

        if (pGet) _customPaths.get = pGet;
        if (pPost) _customPaths.post = pPost;
        if (pPut) _customPaths.put = pPut;
        if (pDelete) _customPaths.delete = pDelete;

        await api(`/${container}/${table}`, {
            method: 'POST',
            body: JSON.stringify({ _init: true, _customPaths })
        });
        closeModal();
        fetchIntrospect();
    };
    modal.classList.remove('hidden');
}

async function deleteTable(container, table) {
    if (!confirm(`Delete table '${table}' from container '${container}'?`)) return;
    await api(`/${container}/${table}`, { method: 'DELETE' });
    fetchIntrospect();
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
    const dataObj = state.introspection.storage[container][table];
    const hasCustom = dataObj.customPaths && Object.keys(dataObj.customPaths).length > 0;

    document.getElementById('table-title').innerText = `Table: ${table}`;
    document.getElementById('table-subtitle').innerHTML = `
        Container: ${container}
        ${hasCustom ? `
            <div style="margin-top:0.5rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
                ${Object.entries(dataObj.customPaths).map(([m, p]) => `
                    <span style="font-size:0.6rem; padding:2px 6px; background:rgba(59,130,246,0.1); color:var(--primary); border-radius:4px; font-weight:700;">
                        ${m.toUpperCase()}: ${p}
                    </span>
                `).join('')}
            </div>
        ` : ''}
    `;

    // Add Schema Management Buttons to Header
    const headerActions = document.querySelector('#view-data .card-header div:last-child');
    headerActions.innerHTML = `
        <button class="btn btn-secondary" onclick="showView('storage')">Back</button>
        <button class="btn btn-secondary" onclick="openSchemaModal()">Columns</button>
        <button class="btn btn-primary" onclick="openCreateModal()">Add Record</button>
    `;

    renderTable();
    showView('data');
}

async function openSchemaModal() {
    const { container, table } = state.activeContext;
    const dataObj = state.introspection.storage[container][table];
    const schema = dataObj.schema_preview || [];

    const modal = document.getElementById('modal-container');
    const fields = document.getElementById('modal-fields');
    document.getElementById('modal-title').innerText = `Manage Columns: ${table}`;
    fields.scrollTop = 0;

    fields.innerHTML = `
        <div id="schema-error" class="error-msg hidden"></div>
        <div style="margin-bottom: 1.5rem;">
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">Current Schema & Types:</p>
            <div class="column-list">
                ${Object.entries(dataObj.schema || {}).map(([col, type]) => `
                    <div class="column-item">
                        <div class="column-info">
                            <span class="column-name">${col}</span>
                            <span class="column-type">${type}</span>
                        </div>
                        ${col !== 'id' ? `
                            <button class="btn-delete-icon" onclick="deleteColumn('${col}')" title="Delete Column">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        ` : '<span style="font-size:0.7rem; color:var(--text-muted)">System</span>'}
                    </div>
                `).join('')}
                ${(!dataObj.schema || Object.keys(dataObj.schema).length === 0) && schema.length > 0 ? `
                    <p style="font-size: 0.7rem; color: var(--text-muted); margin: 0.5rem 0;">Preview from data (untyped):</p>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                        ${schema.map(col => `<span class="badge badge-secondary" style="opacity:0.6">${col}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
        <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border);">
        <div class="form-group">
            <label>Add New Column</label>
            <div style="display:flex; gap:0.5rem">
                <input type="text" id="new-column-name" placeholder="Column Name" style="flex:2">
                <select id="new-column-type" style="flex:1">
                    <option value="String">String</option>
                    <option value="Number">Number</option>
                    <option value="Boolean">Boolean</option>
                    <option value="Date">Date</option>
                </select>
                <button class="btn btn-secondary" onclick="addColumn()">Add</button>
            </div>
        </div>
    `;

    document.getElementById('modal-confirm').style.display = 'none'; // Use inline buttons
    modal.classList.remove('hidden');
}

async function addColumn() {
    const colName = document.getElementById('new-column-name').value;
    const colType = document.getElementById('new-column-type').value;
    const errorEl = document.getElementById('schema-error');

    if (!colName) return;
    errorEl.classList.add('hidden');

    const { container, table } = state.activeContext;

    const { status, data } = await api(`/${container}/${table}/schema-definition`, {
        method: 'PATCH',
        body: JSON.stringify({ name: colName, type: colType })
    });

    if (status !== 200) {
        errorEl.innerText = data.error || 'Failed to update schema';
        errorEl.classList.remove('hidden');
        return;
    }

    showToast('Schema updated');
    await fetchIntrospect();
    renderTable(); // Refresh background table
    openSchemaModal(); // Refresh modal
}

async function deleteColumn(colName) {
    if (!confirm(`Delete column '${colName}'? This will remove it from the validation schema.`)) return;

    const { container, table } = state.activeContext;
    const errorEl = document.getElementById('schema-error');
    errorEl.classList.add('hidden');

    const { status, data } = await api(`/${container}/${table}/schema-definition`, {
        method: 'PATCH',
        body: JSON.stringify({ remove: colName })
    });

    if (status !== 200) {
        errorEl.innerText = data.error || 'Failed to delete column';
        errorEl.classList.remove('hidden');
        return;
    }

    showToast(`Column '${colName}' deleted`);
    await fetchIntrospect();
    renderTable(); // Refresh background table
    openSchemaModal(); // Refresh modal
}

function renderTable() {
    const { container, table } = state.activeContext;
    const dataObj = state.introspection.storage[container][table];
    const records = dataObj.data || [];

    // Combine formal schema keys with keys found in records
    const schemaKeys = Array.from(new Set([
        'id',
        ...(dataObj.schema ? Object.keys(dataObj.schema) : []),
        ...(dataObj.schema_preview || [])
    ]));

    const thead = document.getElementById('data-thead');
    const tbody = document.getElementById('data-tbody');

    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Header
    const tr = document.createElement('tr');
    schemaKeys.forEach(k => {
        const th = document.createElement('th');
        th.innerText = k;
        tr.appendChild(th);
    });
    const actionTh = document.createElement('th');
    actionTh.innerText = 'Actions';
    tr.appendChild(actionTh);
    thead.appendChild(tr);

    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${schemaKeys.length + 1}" style="text-align:center; padding: 2rem; color: var(--text-muted)">No records found. Click 'Add Record' to start.</td></tr>`;
        return;
    }

    // Body
    records.forEach(row => {
        const isEditing = state.editingId === row.id;
        const tr = document.createElement('tr');
        if (isEditing) tr.className = 'editing-row';

        schemaKeys.forEach(k => {
            const td = document.createElement('td');
            if (isEditing && k !== 'id') {
                const type = (dataObj.schema || {})[k] || 'String';
                td.innerHTML = `<input type="text" class="inline-edit-input" data-edit-field="${k}" data-edit-type="${type}" value="${row[k] !== undefined ? row[k] : ''}">`;
            } else {
                td.innerText = row[k] !== undefined ? row[k] : '-';
                if (!isEditing) {
                    td.style.cursor = 'pointer';
                    td.onclick = () => startEditing(row.id);
                }
            }
            tr.appendChild(td);
        });

        const td = document.createElement('td');
        if (isEditing) {
            td.innerHTML = `
                <div style="display:flex; gap:0.4rem">
                    <button class="btn btn-primary" style="padding:4px 8px; font-size:0.7rem" onclick="saveRecord('${row.id}')">Save</button>
                    <button class="btn btn-secondary" style="padding:4px 8px; font-size:0.7rem" onclick="cancelEditing()">Cancel</button>
                </div>
            `;
        } else {
            td.innerHTML = `
                <button class="btn btn-secondary" style="padding:4px 8px" onclick="deleteRecord('${row.id}')">Delete</button>
            `;
        }
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
    document.getElementById('modal-title').innerText = 'Add Record';
    fields.scrollTop = 0;
    fields.innerHTML = '';

    // Use merged schema (formal schema + data preview keys)
    const schemaKeys = Array.from(new Set([
        ...(dataObj.schema ? Object.keys(dataObj.schema) : []),
        ...(dataObj.schema_preview || [])
    ])).filter(k => k !== 'id' && k !== '_init');

    if (schemaKeys.length === 0) {
        fields.innerHTML = `<p style="color:var(--text-muted); font-size:0.8rem">No columns defined yet. Add some in 'Manage Columns' or just add 'name' and 'value' fields below.</p>`;
        ['name', 'value'].forEach(col => {
            fields.innerHTML += `
                <div class="form-group">
                    <label>${col}</label>
                    <input type="text" data-field="${col}" placeholder="Enter ${col}...">
                </div>
            `;
        });
    } else {
        schemaKeys.forEach(col => {
            const type = (dataObj.schema || {})[col] || 'String';
            fields.innerHTML += `
                <div class="form-group">
                    <label>${col} <span style="font-size:0.7rem; color:var(--text-muted)">(${type})</span></label>
                    <input type="text" data-field="${col}" data-type="${type}" placeholder="Enter ${col}...">
                </div>
            `;
        });
    }

    document.getElementById('modal-confirm').onclick = handleCreateRecord;
    modal.classList.remove('hidden');
}

async function handleCreateRecord() {
    const { container, table } = state.activeContext;
    const body = {};
    document.querySelectorAll('[data-field]').forEach(input => {
        body[input.dataset.field] = castValue(input.value, input.dataset.type);
    });

    const { status } = await api(`/${container}/${table}`, {
        method: 'POST',
        body: JSON.stringify(body)
    });

    if (status === 201) {
        closeModal();
        await fetchIntrospect();
        renderTable();
        showToast('Record created successfully');
    }
}

async function deleteRecord(id) {
    const { container, table } = state.activeContext;
    await api(`/${container}/${table}/${id}`, { method: 'DELETE' });
    await fetchIntrospect();
    renderTable();
}

function startEditing(id) {
    state.editingId = id;
    renderTable();
}

function cancelEditing() {
    state.editingId = null;
    renderTable();
}

async function saveRecord(id) {
    const { container, table } = state.activeContext;
    const body = {};
    document.querySelectorAll('.inline-edit-input').forEach(input => {
        body[input.dataset.editField] = castValue(input.value, input.dataset.editType);
    });

    const { status, data } = await api(`/${container}/${table}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
    });

    if (status === 200) {
        state.editingId = null;
        await fetchIntrospect();
        renderTable();
        showToast('Record updated successfully');
    }
}

function closeModal() {
    document.getElementById('modal-container').classList.add('hidden');
    document.getElementById('modal-confirm').style.display = 'inline-flex';
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

function toggleConsole() {
    const panel = document.getElementById('log-panel');
    const main = document.querySelector('main');
    const toggle = document.getElementById('console-toggle');

    panel.classList.toggle('minimized');
    main.classList.toggle('console-minimized');

    toggle.innerText = panel.classList.contains('minimized') ? '▲' : '_';
}

// Entry point
window.onload = init;
