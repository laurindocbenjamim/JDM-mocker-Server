#!/usr/bin/env node

const express = require('express');
const fs = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { program } = require('commander');
const https = require('https');

// CLI configuration
program
    .option('-p, --port <number>', 'Port to run the server on', process.env.PORT || '3000')
    .option('-d, --db-dir <path>', 'Data directory for JSON files', path.join(process.cwd(), 'data'))
    .option('--ssl', 'Enable HTTPS/SSL using server.key and server.cert', false);
program.parse(process.argv);

const options = program.opts();
const PORT = parseInt(options.port, 10);
const DATA_DIR = path.resolve(options.dbDir || options.dir || path.join(process.cwd(), 'data'));

const app = express();
const MAX_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB

let forceSecureCookies = false;

app.use(express.json({ limit: '5mb' })); // ensure payload string matches limit
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // Serve HTML dashboard

// Global Latency simulation middleware
app.use((req, res, next) => {
    const delay = parseInt(process.env.DELAY || '1000', 10);
    setTimeout(next, delay);
});

// Setup master data directory
const ensureDataDir = async () => {
    await fsExtra.ensureDir(DATA_DIR);
};

// ----------------------------------------------------
// Helper Functions: File System & Atomic Writes
// ----------------------------------------------------
const ensureUserDir = async (userId) => {
    const userDir = path.join(DATA_DIR, userId);
    await fsExtra.ensureDir(userDir);
    return userDir;
};

const getPath = (userId, filename) => path.join(DATA_DIR, userId, filename);

// Atomic write mapping to fs-extra / fs.promises
const atomicWriteJson = async (filePath, data) => {
    const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
        await fs.rename(tempPath, filePath);
    } catch (err) {
        try { await fs.unlink(tempPath); } catch (e) { }
        throw err;
    }
};

const readJson = async (filePath) => {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
};

// ----------------------------------------------------
// 1. User Identity & Provisioning
// ----------------------------------------------------

app.post('/auth/register', async (req, res) => {
    const userId = uuidv4();
    await ensureUserDir(userId);

    // Initialize empty sessions
    await atomicWriteJson(getPath(userId, 'sessions.json'), []);

    res.status(201).json({
        message: 'Registration successful',
        'x-user-id': userId
    });
});

// ----------------------------------------------------
// 2. Authentication (Login) & Tokens
// ----------------------------------------------------

app.post('/auth/login', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'Bad Request: x-user-id header is required for login' });
    }

    const userDir = path.join(DATA_DIR, userId);
    if (!await fsExtra.pathExists(userDir)) {
        return res.status(404).json({ error: 'User directory not found' });
    }

    // Determine requested role (default to read-only viewer) and expiration (default 1 hr)
    const role = req.body.role === 'admin' ? 'admin' : 'viewer';
    const expiresInMs = req.body.expiresIn || 3600 * 1000;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

    const sessionRecord = { token, expires_at: expiresAt, role };

    const sessionsPath = getPath(userId, 'sessions.json');
    let sessions = await readJson(sessionsPath);
    if (!sessions) sessions = [];

    sessions.push(sessionRecord);
    await atomicWriteJson(sessionsPath, sessions);

    // Support setting HttpOnly cookie if requested
    if (req.body.useCookie) {
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: options.ssl || forceSecureCookies || process.env.NODE_ENV === 'production',
            sameSite: (options.ssl || forceSecureCookies) ? 'None' : 'Strict',
            maxAge: expiresInMs
        });
    }

    res.json({ message: 'Login successful', token, expires_at: expiresAt, role });
});

// ----------------------------------------------------
// Middleware: Token Validation & RBAC
// ----------------------------------------------------

// Configuration endpoint
app.post('/config/force-secure-cookies', (req, res) => {
    forceSecureCookies = req.body.enabled === true;
    res.json({ message: 'Secure cookie forcing ' + (forceSecureCookies ? 'enabled' : 'disabled') });
});

// Ignore auth middleware for /auth/register and /auth/login
const authPaths = ['/auth/register', '/auth/login', '/config/force-secure-cookies', '/admin/dashboard'];

app.use(async (req, res, next) => {
    if (authPaths.includes(req.path)) {
        return next();
    }

    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: Missing x-user-id header' });
    }

    const userDir = path.join(DATA_DIR, userId);
    if (!await fsExtra.pathExists(userDir)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid user ID' });
    }

    // Extract token
    let token = null;
    const authHeader = req.headers['authorization'];
    const csrfHeader = req.headers['csrf-token'] || req.headers['x-csrf-token'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (csrfHeader) {
        token = csrfHeader;
    } else if (req.cookies && req.cookies.auth_token) {
        token = req.cookies.auth_token;
    }

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Missing Bearer token, CSRF token, or cookie' });
    }

    // Validate Token against sessions.json
    const sessions = await readJson(getPath(userId, 'sessions.json')) || [];
    const session = sessions.find(s => s.token === token);

    if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Check Expiration
    if (new Date(session.expires_at) < new Date()) {
        return res.status(401).json({ error: 'token_expired' });
    }

    req.userId = userId;
    req.userDir = userDir;
    req.userRole = session.role; // Extract role for RBAC

    next();
});

// Role-Based Access Control (RBAC) middleware
app.use((req, res, next) => {
    if (authPaths.includes(req.path)) return next();

    // Prevent viewers from performing destructive actions
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        // Except for update-uuid and account which we'll handle directly (though they're destructive)
        // Wait, standard RBAC for data ops:
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Admin role required for this action' });
        }
    }
    next();
});

// ----------------------------------------------------
// 3. User Identity Ops (Update / Delete)
// ----------------------------------------------------

app.patch('/auth/update-uuid', async (req, res) => {
    // Requires Admin or specific logic. We allowed Admin in previous middleware for PATCH.
    const newUserId = uuidv4();
    const newUserDir = path.join(DATA_DIR, newUserId);

    // Move the entire folder structure
    try {
        await fsExtra.move(req.userDir, newUserDir);
        res.json({ message: 'UUID updated successfully', 'x-user-id': newUserId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update UUID' });
    }
});

app.delete('/auth/account', async (req, res) => {
    try {
        await fsExtra.remove(req.userDir);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// ----------------------------------------------------
// Middleware: Quotas & Resource Management 
// ----------------------------------------------------

// 1. Rate Limiting (100 req / minute per x-user-id or IP if missing)
const userRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    validate: { xForwardedForHeader: false },
    keyGenerator: (req) => req.headers['x-user-id'] || 'default-ip', // Avoiding strict error enforcement by library validator
    message: { error: 'Too Many Requests: Rate limit of 100 req/min exceeded.' }
});

app.use(userRateLimiter);

// 2. Storage Quota Checker (5MB limit per UUID folder)
const checkStorageQuota = async (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.userDir) {
        try {
            const files = await fs.readdir(req.userDir);
            let totalBytes = 0;
            for (const file of files) {
                const stat = await fs.stat(getPath(req.userId, file));
                totalBytes += stat.size;
            }
            // Add approx incoming payload size
            const incomingSize = parseInt(req.headers['content-length'] || '0', 10);
            if (totalBytes + incomingSize > MAX_QUOTA_BYTES) {
                return res.status(413).json({ error: 'Payload Too Large: 5MB storage quota exceeded for this UUID.' });
            }
        } catch (e) {
            // Ignore if folder doesn't exist yet
        }
    }
    next();
};

app.use(checkStorageQuota);

// 3. Inactivity Cleanup (Delete UUIDs untouched for > 7 days)
const runCleanupLogic = async () => {
    try {
        const folders = await fs.readdir(DATA_DIR);
        const threshold = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago

        for (const folder of folders) {
            const folderPath = path.join(DATA_DIR, folder);
            const stats = await fs.stat(folderPath);

            if (stats.isDirectory() && stats.mtimeMs < threshold) {
                console.log(`[Cleanup] Deleting inactive UUID: ${folder}`);
                await fsExtra.remove(folderPath);
            }
        }
    } catch (e) {
        console.error('[Cleanup Error]', e);
    }
};

// Run cleanup aggressively once a day or on boot
setTimeout(runCleanupLogic, 5000);
setInterval(runCleanupLogic, 24 * 60 * 60 * 1000);


// ----------------------------------------------------
// 4. Introspection & Admin Ops
// ----------------------------------------------------

// Introspection API: Dump total state of user's UUID space
app.get('/introspect', async (req, res) => {
    try {
        const payload = {
            userId: req.userId,
            role: req.userRole,
            sessions: await readJson(getPath(req.userId, 'sessions.json')) || [],
            storage: {}
        };

        const files = await fs.readdir(req.userDir);
        for (const file of files) {
            if (file.endsWith('.json') && file !== 'sessions.json') {
                const containerName = file.replace('.json', '');
                const content = await readJson(getPath(req.userId, file));
                payload.storage[containerName] = {};
                if (content) {
                    for (const [table, records] of Object.entries(content)) {
                        payload.storage[containerName][table] = {
                            count: Array.isArray(records) ? records.length : 0,
                            schema_preview: Array.isArray(records) && records.length > 0 ? Object.keys(records[0]) : [],
                            data: records
                        };
                    }
                }
            }
        }
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Introspection failed' });
    }
});

// Admin Dashboard: serves public/index.html
app.get('/admin/dashboard', (req, res) => {
    // Determine path based on if running globally or locally
    // For the UI to keep serving reliably from the package root:
    const publicPath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(publicPath);
});

// ----------------------------------------------------
// 5. Container Ops
// ----------------------------------------------------

app.get('/containers', async (req, res) => {
    try {
        const files = await fs.readdir(req.userDir);
        const containers = files.filter(f => f.endsWith('.json') && f !== 'sessions.json').map(f => f.replace('.json', ''));
        res.json({ containers });
    } catch (err) {
        res.status(500).json({ error: 'Error reading containers' });
    }
});

app.delete('/containers/:name', async (req, res) => {
    const { name } = req.params;
    const filePath = getPath(req.userId, `${name}.json`);
    try {
        await fs.unlink(filePath);
        res.status(204).send();
    } catch (err) {
        res.status(404).json({ error: 'Container not found' });
    }
});

// ----------------------------------------------------
// 5. Table Ops
// ----------------------------------------------------

app.delete('/:container/:table', async (req, res) => {
    const { container, table } = req.params;
    const filePath = getPath(req.userId, `${container}.json`);
    const data = await readJson(filePath);

    if (!data || !data[table]) return res.status(404).json({ error: `Table '${table}' not found` });

    delete data[table];
    await atomicWriteJson(filePath, data);
    res.status(204).send();
});

app.patch('/:container/:table/rename', async (req, res) => {
    const { container, table } = req.params;
    const { newName } = req.body;

    if (!newName) return res.status(400).json({ error: 'Bad Request: newName required' });

    const filePath = getPath(req.userId, `${container}.json`);
    const data = await readJson(filePath);

    if (!data || !data[table]) return res.status(404).json({ error: `Table '${table}' not found` });
    if (data[newName]) return res.status(400).json({ error: `Table '${newName}' already exists` });

    data[newName] = data[table];
    delete data[table];
    await atomicWriteJson(filePath, data);

    res.json({ message: `Table renamed to '${newName}'` });
});

app.patch('/:container/:table/schema', async (req, res) => {
    const { container, table } = req.params;
    const { remove, rename, set } = req.body;

    const filePath = getPath(req.userId, `${container}.json`);
    const data = await readJson(filePath);

    if (!data || !data[table]) {
        return res.status(400).json({ error: `Table '${table}' is invalid or not found` });
    }

    const isStructured = !Array.isArray(data[table]);
    const records = isStructured ? data[table].records : data[table];

    if (!Array.isArray(records)) {
        return res.status(400).json({ error: `Table '${table}' is invalid or not found` });
    }

    const updatedRecords = records.map(record => {
        if (rename) Object.entries(rename).forEach(([o, n]) => { if (record[o] !== undefined) { record[n] = record[o]; delete record[o]; } });
        if (remove) remove.forEach(k => delete record[k]);
        if (set) Object.entries(set).forEach(([k, v]) => { record[k] = v; });
        return record;
    });

    if (isStructured) {
        data[table].records = updatedRecords;
    } else {
        data[table] = updatedRecords;
    }

    await atomicWriteJson(filePath, data);
    res.json({ message: `Schema bulk update applied`, count: updatedRecords.length });
});

// ----------------------------------------------------
// Helper: Extract valid records array from raw table data
// ----------------------------------------------------
const getTableRecords = (tableData) => {
    if (!tableData) return null;
    return Array.isArray(tableData) ? tableData : tableData.records;
};

// ----------------------------------------------------
// 6. Data Ops (Full CRUD on /:container/:table & ID)
// ----------------------------------------------------

app.get('/:container/:table', async (req, res) => {
    const { container, table } = req.params;
    const filePath = getPath(req.userId, `${container}.json`);
    const data = await readJson(filePath);

    if (!data || !data[table]) return res.status(404).json({ error: `Table '${table}' not found` });

    let records = getTableRecords(data[table]);

    // Support filtering
    const { page, limit, ...filters } = req.query;
    if (Object.keys(filters).length > 0) {
        records = records.filter(record => {
            return Object.entries(filters).every(([k, v]) => String(record[k]) === String(v));
        });
    }

    // Support pagination
    if (page || limit) {
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const start = (pageNum - 1) * limitNum;
        const end = start + limitNum;

        return res.json({
            page: pageNum,
            limit: limitNum,
            total: records.length,
            data: records.slice(start, end)
        });
    }

    res.json(records);
});

app.get('/:container/:table/:id', async (req, res) => {
    const { container, table, id } = req.params;
    const filePath = getPath(req.userId, `${container}.json`);
    const data = await readJson(filePath);

    if (!data || !data[table]) return res.status(404).json({ error: 'Table not found' });

    const records = getTableRecords(data[table]);
    const record = records.find(r => r.id === id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    res.json(record);
});

// ----------------------------------------------------
// Schema Validation Engine
// ----------------------------------------------------
const validateAgainstSchema = (payload, schema) => {
    if (!schema || Object.keys(schema).length === 0) return null;

    for (const [key, type] of Object.entries(schema)) {
        const val = payload[key];
        if (val === undefined || val === null) continue; // Skip missing optional fields

        if (type === 'String' && typeof val !== 'string') return `Field '${key}' expects String`;
        if (type === 'Number' && typeof val !== 'number') return `Field '${key}' expects Number`;
        if (type === 'Boolean' && typeof val !== 'boolean') return `Field '${key}' expects Boolean`;
        if (type === 'Date' && isNaN(Date.parse(val))) return `Field '${key}' expects a valid ISO Date string`;
    }
    return null; // No errors
};

app.post('/:container/:table', async (req, res) => {
    const { container, table } = req.params;
    const filePath = getPath(req.userId, `${container}.json`);

    let data = await readJson(filePath) || {};

    // Check if user is initializing a table specifically with a _schema defined in root payload
    if (!data[table] && req.body._schema) {
        data[table] = { _schema: req.body._schema, records: [] };
        delete req.body._schema;

        // If they only sent the schema to init the table, return early.
        if (Object.keys(req.body).length === 0) {
            await atomicWriteJson(filePath, data);
            return res.status(201).json({ message: 'Table initialized with schema' });
        }
    } else if (!data[table]) {
        // Init as standard unstructured array
        data[table] = [];
    }

    // Extract schema and records based on table structure
    const isStructured = !Array.isArray(data[table]);
    const schema = isStructured ? data[table]._schema : null;
    const records = isStructured ? data[table].records : data[table];

    // Remove any accidental _schema injection via normal POST to an existing table
    delete req.body._schema;

    // Validate if schema exists
    if (schema) {
        const validationError = validateAgainstSchema(req.body, schema);
        if (validationError) return res.status(400).json({ error: `Validation Error: ${validationError}` });
    }

    const newRecord = { id: uuidv4(), ...req.body };
    records.push(newRecord);

    await atomicWriteJson(filePath, data);
    res.status(201).json(newRecord);
});

app.put('/:container/:table/:id', async (req, res) => {
    const { container, table, id } = req.params;
    const filePath = getPath(req.userId, `${container}.json`);
    const data = await readJson(filePath);

    if (!data || !data[table]) return res.status(404).json({ error: 'Table not found' });

    const isStructured = !Array.isArray(data[table]);
    const schema = isStructured ? data[table]._schema : null;
    const records = isStructured ? data[table].records : data[table];

    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    // Validate if schema exists
    if (schema) {
        // Prevent accidental schema injection via PUT
        delete req.body._schema;
        const validationError = validateAgainstSchema(req.body, schema);
        if (validationError) return res.status(400).json({ error: `Validation Error: ${validationError}` });
    }

    records[idx] = { id, ...req.body };
    await atomicWriteJson(filePath, data);

    res.json(records[idx]);
});

app.delete('/:container/:table/:id', async (req, res) => {
    const { container, table, id } = req.params;
    const filePath = getPath(req.userId, `${container}.json`);
    const data = await readJson(filePath);

    if (!data || !data[table]) return res.status(404).json({ error: 'Table not found' });

    const isStructured = !Array.isArray(data[table]);
    const records = isStructured ? data[table].records : data[table];

    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    records.splice(idx, 1);
    await atomicWriteJson(filePath, data);
    res.status(204).send();
});

// Handle generic malformed JSON from express.json()
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Bad Request: Malformed JSON' });
    }
    next(err);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

const startServer = async () => {
    await ensureDataDir();

    const protocol = options.ssl ? 'https' : 'http';

    if (options.ssl) {
        try {
            const privateKey = await fs.readFile(path.join(process.cwd(), 'server.key'), 'utf8');
            const certificate = await fs.readFile(path.join(process.cwd(), 'server.cert'), 'utf8');
            const credentials = { key: privateKey, cert: certificate };

            const httpsServer = https.createServer(credentials, app);
            httpsServer.listen(PORT, logStartup(protocol));
        } catch (err) {
            console.error('SSL Error: Could not read server.key or server.cert. Please ensure they exist locally within the Execution Context.', err.message);
            process.exit(1);
        }
    } else {
        app.listen(PORT, logStartup(protocol));
    }
};

const logStartup = (protocol) => () => {
    console.log(`\n======================================================`);
    console.log(`🚀 jdm-mocker-Server is running!`);
    console.log(`📂 Data Directory : ${DATA_DIR}`);
    console.log(`🌐 Local API Base : ${protocol}://localhost:${PORT}`);
    console.log(`⚙️  Admin Dashboard: ${protocol}://localhost:${PORT}/admin/dashboard`);
    console.log(`======================================================\n`);
};

startServer();
