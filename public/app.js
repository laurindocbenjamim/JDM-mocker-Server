const BASE_URL = ''; // Relative path for local/prod compatibility

// Global State
let state = {
    userId: localStorage.getItem('jdm_test_id') || '',
    token: localStorage.getItem('jdm_test_token') || '',
    apiKey: localStorage.getItem('jdm_test_apiKey') || '',
    role: 'N/A',
    introspection: null,
    activeContext: { container: '', table: '' },
    editingId: null,
    editingPk: '_id',
    isEditingPk: false
};

// --- Initialization ---
function init() {
    updateIdentityUI();
    log('System initialized. Client ready.');
    if (state.userId && (state.token || state.apiKey)) {
        fetchIntrospect();
    }
    initResizer();

    // Initialize Mobile UI
    const overlay = document.createElement('div');
    overlay.id = 'menu-overlay';
    overlay.onclick = toggleMenu;
    document.body.appendChild(overlay);

    const mobileHeader = document.createElement('div');
    mobileHeader.className = 'mobile-header';
    mobileHeader.innerHTML = `
        <div class="brand" style="margin-bottom:0">
            <img src="/assets/logo.png" alt="JDM MOCK Logo" style="width: 24px; height: 24px;">
            <span>JDM MOCK</span>
        </div>
        <button class="btn-icon" onclick="toggleMenu()" style="margin-left:auto; background:none; border:none; color:var(--primary); cursor:pointer;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
        </button>
    `;
    document.body.insertBefore(mobileHeader, document.body.firstChild);
}

// --- Navigation ---
function showView(viewId) {
    document.querySelectorAll('.content-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    // Find active nav item
    if (viewId === 'auth') document.querySelector('[onclick*="auth"]').classList.add('active');
    if (viewId === 'storage') document.getElementById('nav-storage').classList.add('active');

    if (window.innerWidth <= 992) {
        toggleMenu(); // Close menu on navigation
    }
}

function initResizer() {
    const resizer = document.getElementById('log-resizer');
    const panel = document.getElementById('log-panel');
    const main = document.querySelector('main');
    let isDragging = false;

    resizer.addEventListener('mousedown', (e) => {
        isDragging = true;
        document.body.style.cursor = 'ns-resize';
        const panelRect = panel.getBoundingClientRect();
        panel.style.transition = 'none'; // Disable transition during drag
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 40 && newHeight < window.innerHeight * 0.8) {
            panel.style.height = `${newHeight}px`;
            main.style.paddingBottom = `${newHeight + 20}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = 'default';
            panel.style.transition = 'left 0.3s'; // Restore partial transition
        }
    });
}

function toggleMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('menu-overlay');
    sidebar.classList.toggle('menu-open');
    overlay.classList.toggle('active');
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

// --- Security Actions ---
async function fetchSecuritySettings() {
    if (!state.userId) return;
    const { status, data } = await api('/auth/security');
    if (status === 200 && data.validation) {
        Object.entries(data.validation).forEach(([method, enabled]) => {
            const el = document.getElementById(`auth-val-${method}`);
            if (el) el.checked = enabled;
        });
    }
}

async function updateSecuritySettings() {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const validation = {};
    methods.forEach(m => {
        validation[m] = document.getElementById(`auth-val-${m}`).checked;
    });

    const statusEl = document.getElementById('security-status');
    statusEl.classList.remove('hidden');

    const { status } = await api('/auth/security', {
        method: 'PATCH',
        body: JSON.stringify({ validation })
    });

    setTimeout(() => {
        statusEl.classList.add('hidden');
        if (status === 200) showToast('Security settings updated');
        else showToast('Failed to update security settings', true);
    }, 500);
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

        if (state.introspection.storage[container] && state.introspection.storage[container][table]) {
            alert(`Table '${table}' already exists in container '${container}'`);
            return;
        }

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

    if (state.introspection.storage[container]) {
        showToast(`Container '${container}' already exists`, 'warning');
        return;
    }

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
    state.editingPk = dataObj.primaryKey || '_id';

    document.getElementById('table-title').innerText = `Table: ${table}`;
    document.getElementById('table-subtitle').innerText = `Container: ${container} | PK: ${state.editingPk}`;

    renderTable();
    renderEndpoints(container, table);
    showView('data');
}

// Handlers removed/integrated into simplified modal logic

function renderEndpoints(container, table) {
    const dataObj = state.introspection.storage[container][table];
    const customPaths = dataObj.customPaths || {};
    const list = document.getElementById('endpoints-list');
    list.innerHTML = '';

    const host = window.location.origin;
    const endpoints = [];

    // Standard Endpoints (Logical fallback)
    const defaults = {
        get: `/${container}/${table}`,
        post: `/${container}/${table}`,
        get_pk: `/${container}/${table}/:${state.editingPk}`,
        patch: `/${container}/${table}/:${state.editingPk}`,
        delete: `/${container}/${table}/:${state.editingPk}`
    };

    const methods = [
        { id: 'get', name: 'GET', default: defaults.get },
        { id: 'post', name: 'POST', default: defaults.post },
        { id: 'get_pk', name: 'GET (BY ID)', default: defaults.get_pk, customKey: 'get' }, // Note: we use 'get' for custom path mapping on both
        { id: 'patch', name: 'PATCH', default: defaults.patch },
        { id: 'delete', name: 'DELETE', default: defaults.delete }
    ];

    methods.forEach(m => {
        const custom = customPaths[m.id === 'get_pk' ? 'get' : m.id];
        let path = custom || m.default;
        if (m.id === 'get_pk' && custom) path = custom + '/:' + state.editingPk;

        const item = document.createElement('div');
        item.className = 'endpoint-item';
        const fullUrl = `${host}${path}`;

        item.innerHTML = `
            <div class="endpoint-info">
                <span class="endpoint-method badge-${m.name.split(' ')[0].toLowerCase()}">${m.name}</span>
                <span class="endpoint-path">${path} ${custom ? '<span style="color:var(--primary); font-size:0.6rem;">(CUSTOM)</span>' : ''}</span>
            </div>
            <button class="copy-btn" onclick="copyToClipboard('${fullUrl}')">Copy URL</button>
        `;
        list.appendChild(item);
    });
}

function openCustomEndpointsModal() {
    const { container, table } = state.activeContext;
    const dataObj = state.introspection.storage[container][table];
    const customPaths = dataObj.customPaths || {};

    const modal = document.getElementById('modal-container');
    const fields = document.getElementById('modal-fields');
    document.getElementById('modal-title').innerText = `Endpoints: ${table}`;
    fields.scrollTop = 0;

    const defaults = {
        get: `/${container}/${table}`,
        post: `/${container}/${table}`,
        patch: `/${container}/${table}/:${state.editingPk}`,
        put: `/${container}/${table}/:${state.editingPk}`,
        delete: `/${container}/${table}/:${state.editingPk}`
    };

    fields.innerHTML = `
        <div id="custom-path-error" class="error-msg hidden"></div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
            <p style="font-size: 0.8rem; color: var(--text-muted); margin:0">Edit or override standard API endpoints.</p>
            <button class="btn btn-primary" style="padding: 4px 12px; font-size: 0.75rem;" onclick="showAddEndpointRow()">+ ADD</button>
        </div>

        <div class="column-list" id="endpoints-mgmt-list">
            ${['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map(method => {
        const m = method.toLowerCase();
        const path = customPaths[m] || defaults[m];
        const isCustom = !!customPaths[m];

        return `
                    <div class="column-item" style="padding: 0.75rem; border-left: 3px solid ${isCustom ? 'var(--primary)' : 'transparent'};">
                        <div style="display:flex; align-items:center; gap:0.5rem; flex:1">
                            <span class="badge badge-${m}" style="width:60px; text-align:center">${method}</span>
                            <input type="text" class="endpoint-edit-input" data-method="${m}" value="${path}" 
                                style="flex:1; height:32px; font-size:0.85rem; background:${isCustom ? 'rgba(59,130,246,0.05)' : 'transparent'}; border:${isCustom ? '1px solid var(--primary)' : '1px solid var(--border)'};">
                        </div>
                        ${isCustom ? `
                            <button class="btn btn-secondary" onclick="deleteCustomPath('${m}')" style="margin-left:0.5rem; padding: 4px 8px; font-size: 0.7rem;">Reset</button>
                        ` : ''}
                    </div>
                `;
    }).join('')}
        </div>

        <div id="add-endpoint-row" class="hidden" style="margin-top:1rem; padding:1rem; border:1px dashed var(--primary); border-radius:8px; background:rgba(59,130,246,0.05)">
            <div style="display:flex; gap:0.5rem; align-items:center">
                <select id="new-ep-method" style="flex:0.3; height:32px; font-size:0.8rem">
                    <option value="get">GET</option>
                    <option value="post">POST</option>
                    <option value="patch">PATCH</option>
                    <option value="put">PUT</option>
                    <option value="delete">DELETE</option>
                </select>
                <input type="text" id="new-ep-path" placeholder="/api/v1/custom" style="flex:1; height:32px; font-size:0.8rem">
                <button class="btn btn-primary" style="padding:4px 8px; font-size:0.75rem" onclick="addNewEndpoint()">Add</button>
            </div>
        </div>
    `;

    document.getElementById('modal-confirm').style.display = 'inline-flex';
    document.getElementById('modal-confirm').innerText = 'Save Endpoints';
    document.getElementById('modal-confirm').onclick = saveAllCustomPaths;
    modal.classList.remove('hidden');
}

function showAddEndpointRow() {
    document.getElementById('add-endpoint-row').classList.remove('hidden');
}

async function addNewEndpoint() {
    const method = document.getElementById('new-ep-method').value;
    const path = document.getElementById('new-ep-path').value.trim();
    if (!path) return;

    // Add to the list statically so it can be saved with saveAllCustomPaths
    const container = document.getElementById('endpoints-mgmt-list');
    const existing = container.querySelector(`[data-method="${method}"]`);
    if (existing) {
        existing.value = path;
        existing.style.background = 'rgba(59,130,246,0.05)';
        existing.style.border = '1px solid var(--primary)';
    }
    document.getElementById('new-ep-path').value = '';
    document.getElementById('add-endpoint-row').classList.add('hidden');
}

async function saveAllCustomPaths() {
    const { container, table } = state.activeContext;
    const defaults = {
        get: `/${container}/${table}`,
        post: `/${container}/${table}`,
        patch: `/${container}/${table}/:${state.editingPk}`,
        put: `/${container}/${table}/:${state.editingPk}`,
        delete: `/${container}/${table}/:${state.editingPk}`
    };

    const customPaths = {};
    document.querySelectorAll('.endpoint-edit-input').forEach(input => {
        const m = input.dataset.method;
        const val = input.value.trim();
        // Only save if it differs from default
        if (val && val !== defaults[m]) {
            customPaths[m] = val.startsWith('/') ? val : '/' + val;
        }
    });

    const { status, data } = await api(`/${container}/${table}/custom-paths`, {
        method: 'PATCH',
        body: JSON.stringify({ customPaths })
    });

    if (status === 200) {
        showToast('Endpoints saved');
        await fetchIntrospect();
        renderEndpoints(container, table);
        closeModal();
    } else {
        const errorEl = document.getElementById('custom-path-error');
        errorEl.innerText = data.error || 'Failed to update custom paths';
        errorEl.classList.remove('hidden');
    }
}

async function deleteCustomPath(method) {
    const { container, table } = state.activeContext;
    if (!confirm(`Remove custom path for ${method}?`)) return;

    const { status } = await api(`/${container}/${table}/custom-paths`, {
        method: 'PATCH',
        body: JSON.stringify({ remove: method })
    });

    if (status === 200) {
        showToast(`${method} path removed`);
        await fetchIntrospect();
        renderEndpoints(container, table);
        openCustomEndpointsModal(); // Refresh
    }
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
        
        <div class="form-group" style="background: rgba(59,130,246,0.05); padding: 1rem; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 1.5rem;">
            <label style="font-weight: 700; color: var(--primary); margin-bottom: 0.75rem; display: block;">Add New Column</label>
            <div style="display:flex; gap:0.5rem">
                <input type="text" id="new-column-name" placeholder="Column Name" style="flex:2; height: 38px;">
                <select id="new-column-type" style="flex:1; height: 38px;">
                    <option value="String">String</option>
                    <option value="Number">Number</option>
                    <option value="Boolean">Boolean</option>
                    <option value="Date">Date</option>
                </select>
                <button class="btn btn-primary" onclick="addColumn()" style="height: 38px; padding: 0 1.5rem;">Add</button>
            </div>
        </div>

        <div style="margin-bottom: 1.5rem;">
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; font-weight:600">Current Schema & Primary Key:</p>
            <div class="column-list">
                ${Object.entries(dataObj.schema || {}).map(([col, type]) => {
        const isPk = col === state.editingPk;
        return `
                        <div class="column-item" style="border-left: 3px solid ${isPk ? 'var(--primary)' : 'transparent'}">
                            <div class="column-info">
                                <span class="column-name">${col} ${isPk ? '<span class="badge badge-get" style="font-size:0.5rem; margin-left:4px">PK</span>' : ''}</span>
                                <span class="column-type">${type}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:0.4rem">
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.75rem; color:var(--text-muted); padding: 4px 12px; border-radius:4px; border: 1px solid ${isPk ? 'var(--primary)' : 'var(--border)'}; ${isPk ? 'background:rgba(59,130,246,0.1); color:var(--primary)' : ''}">
                                    <input type="checkbox" ${isPk ? 'disabled checked' : ''} onchange="if(this.checked) setAsPrimaryKey('${col}')" style="cursor:pointer; width:16px; height:16px;">
                                    PK
                                </label>
                                ${col !== '_id' ? `
                                    <button class="btn-delete-icon" onclick="deleteColumn('${col}')" title="Delete Column">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                        </svg>
                                    </button>
                                ` : '<span style="font-size:0.7rem; color:var(--text-muted); align-self:center">System</span>'}
                            </div>
                        </div>
                    `;
    }).join('')}
                ${(!dataObj.schema || Object.keys(dataObj.schema).length === 0) && schema.length > 0 ? `
                    <p style="font-size: 0.7rem; color: var(--text-muted); margin: 1rem 0 0.5rem 0;">Preview from data (untyped):</p>
                    <div style="display: grid; grid-template-columns: 1fr; gap:0.5rem;">
                        ${schema.map(col => `
                             <div class="column-item" style="padding: 0.5rem;">
                                <span style="font-size:0.85rem; font-weight:500">${col}</span>
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.75rem; color:var(--text-muted); padding: 2px 10px; border-radius:4px; border: 1px solid var(--border);">
                                    <input type="checkbox" onchange="if(this.checked) setAsPrimaryKey('${col}')" style="cursor:pointer">
                                    Set as PK
                                </label>
                             </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    document.getElementById('modal-confirm').style.display = 'inline-flex';
    document.getElementById('modal-confirm').innerText = 'Done';
    document.getElementById('modal-confirm').onclick = closeModal;
    modal.classList.remove('hidden');
}

async function setAsPrimaryKey(pk) {
    const { container, table } = state.activeContext;
    const { status } = await api(`/${container}/${table}/primary-key`, {
        method: 'PATCH',
        body: JSON.stringify({ primaryKey: pk })
    });

    if (status === 200) {
        showToast(`Primary key set to ${pk}`);
        await fetchIntrospect();
        state.editingPk = pk;
        viewTable(container, table); // Refresh view
        openSchemaModal(); // Refresh modal
    }
}

async function addColumn() {
    const colName = document.getElementById('new-column-name').value;
    const colType = document.getElementById('new-column-type').value;
    const errorEl = document.getElementById('schema-error');

    if (!colName) return;
    errorEl.classList.add('hidden');

    const { container, table } = state.activeContext;
    const dataObj = state.introspection.storage[container][table];

    if (dataObj.schema && dataObj.schema[colName]) {
        errorEl.innerText = `Column '${colName}' already exists`;
        errorEl.classList.remove('hidden');
        return;
    }

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
        state.editingPk,
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
        const rowPkValue = row[state.editingPk];
        const isEditing = state.editingId === rowPkValue;
        const tr = document.createElement('tr');
        if (isEditing) tr.className = 'editing-row';

        schemaKeys.forEach(k => {
            const td = document.createElement('td');
            if (isEditing && k !== state.editingPk) {
                const type = (dataObj.schema || {})[k] || 'String';
                td.innerHTML = `<input type="text" class="inline-edit-input" data-edit-field="${k}" data-edit-type="${type}" value="${row[k] !== undefined ? row[k] : ''}">`;
            } else {
                td.innerText = row[k] !== undefined ? row[k] : '-';
                if (!isEditing) {
                    td.style.cursor = 'pointer';
                    td.onclick = () => startEditing(rowPkValue);
                }
            }
            tr.appendChild(td);
        });

        const td = document.createElement('td');
        if (isEditing) {
            td.innerHTML = `
                <div style="display:flex; gap:0.4rem">
                    <button class="btn btn-primary" style="padding:4px 8px; font-size:0.7rem" onclick="saveRecord('${rowPkValue}')">Save</button>
                    <button class="btn btn-secondary" style="padding:4px 8px; font-size:0.7rem" onclick="cancelEditing()">Cancel</button>
                </div>
            `;
        } else {
            td.innerHTML = `
                <button class="btn btn-secondary" style="padding:4px 8px" onclick="deleteRecord('${rowPkValue}')">Delete</button>
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
    ])).filter(k => k !== state.editingPk && k !== '_init');

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

    const confirmBtn = document.getElementById('modal-confirm');
    confirmBtn.style.display = 'inline-flex';
    confirmBtn.innerText = 'Save Record';
    confirmBtn.onclick = handleCreateRecord;
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

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!');
    }).catch(err => {
        showToast('Failed to copy', 'error');
    });
}

// --- Identity UI ---
function updateIdentityUI() {
    document.getElementById('display-uuid').innerText = state.userId || 'None';
    document.getElementById('display-role').innerText = state.role || 'N/A';

    // Sync config inputs
    document.getElementById('cfg-user-id').value = state.userId || '';
    document.getElementById('cfg-api-key').value = state.apiKey || '';
    document.getElementById('cfg-token').value = state.token || '';

    if (state.userId) {
        fetchSecuritySettings();
    }
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

    const isMinimized = panel.classList.toggle('minimized');
    main.classList.toggle('console-minimized');

    if (isMinimized) {
        toggle.innerText = '▲';
        panel.style.height = '40px';
        main.style.paddingBottom = '60px';
    } else {
        toggle.innerText = '_';
        panel.style.height = '250px';
        main.style.paddingBottom = '270px';
    }
}

// Entry point
window.onload = init;
