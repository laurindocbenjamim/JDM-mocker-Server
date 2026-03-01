#!/usr/bin/env node

const express = require('express');
const fs = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const { program } = require('commander');
const https = require('https');
const crypto = require('crypto');
const logger = require('./logger');
require('dotenv').config();

// CLI configuration
program
    .option('-p, --port <number>', 'Port to run the server on', process.env.PORT || '3000')
    .option('-d, --db-dir <path>', 'Local data directory', path.join(process.cwd(), 'data'))
    .option('--ssl', 'Enable HTTPS/SSL', false)
    .parse(process.argv);

const options = program.opts();
const PORT = parseInt(options.port, 10);
const DATA_DIR = path.resolve(options.dbDir);
const STORE_MODE = process.env.STORE_DATA_IN || 'local';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

const JDM_VERSION = "1.1.0-AUTH-FIX";
const app = express();

// ----------------------------------------------------
// Storage Engine
// ----------------------------------------------------
let db = null;
let mongoClient = null;

const Storage = {
    async init() {
        if (STORE_MODE === 'mongodb') {
            try {
                mongoClient = new MongoClient(process.env.MONGODB_URI, {
                    tls: true,
                    serverSelectionTimeoutMS: 5000
                });
                await mongoClient.connect();
                await mongoClient.db("admin").command({ ping: 1 });
                const urlParts = new URL(process.env.MONGODB_URI);
                const dbName = urlParts.pathname.split('/')[1] || 'data_tuning_school';
                db = mongoClient.db(dbName);
                console.log(`📦 Connected to MongoDB: ${db.databaseName}`);
            } catch (err) {
                console.error('❌ MongoDB Connection Failed:', err.message);
                process.exit(1);
            }
        } else {
            await fsExtra.ensureDir(DATA_DIR);
            console.log(`📂 Using Local Storage: ${DATA_DIR}`);
        }
        await this.seedDeveloper();
    },

    async seedDeveloper() {
        const devEmail = process.env.ADMIN_EMAIL;
        const devPass = process.env.ADMIN_PASSWORD;
        const hashedPassword = crypto.createHash('sha256').update(devPass).digest('hex');
        const devUser = {
            email: devEmail,
            password: hashedPassword,
            name: "Laurindo Benjamim",
            role: "admin",
            userId: "dev-master-root",
            createdAt: new Date("2026-02-27T00:00:00Z")
        };
        if (STORE_MODE === 'mongodb') {
            const existing = await db.collection('users').findOne({ email: devEmail });
            if (!existing) await db.collection('users').insertOne(devUser);
        } else {
            const devDir = path.join(DATA_DIR, devUser.userId);
            await fsExtra.ensureDir(devDir);
            const profilePath = path.join(devDir, 'profile.json');
            if (!await fsExtra.pathExists(profilePath)) {
                await fs.writeFile(profilePath, JSON.stringify(devUser, null, 2));
            }
        }
    },

    async getUserSessions(userId) {
        if (STORE_MODE === 'mongodb') {
            const user = await db.collection('users').findOne({ userId });
            return user ? user.sessions || [] : [];
        } else {
            const sessionPath = path.join(DATA_DIR, userId, 'sessions.json');
            try { return JSON.parse(await fs.readFile(sessionPath, 'utf8')); } catch { return []; }
        }
    },

    async saveUserSession(userId, sessionData) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('users').updateOne({ userId }, { $push: { sessions: sessionData } }, { upsert: true });
        } else {
            const sessions = await this.getUserSessions(userId);
            sessions.push(sessionData);
            await fs.writeFile(path.join(DATA_DIR, userId, 'sessions.json'), JSON.stringify(sessions, null, 2));
        }
    },

    async readContainer(userId, name) {
        if (STORE_MODE === 'mongodb') {
            const doc = await db.collection('containers').findOne({ userId, name });
            return doc ? doc.data : null;
        } else {
            try {
                return JSON.parse(await fs.readFile(path.join(DATA_DIR, userId, `${name}.json`), 'utf8'));
            } catch { return null; }
        }
    },

    async writeContainer(userId, name, data) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('containers').updateOne({ userId, name }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
        } else {
            await fsExtra.ensureDir(path.join(DATA_DIR, userId));
            await fs.writeFile(path.join(DATA_DIR, userId, `${name}.json`), JSON.stringify(data, null, 2));
        }
    },

    async deleteContainer(userId, name) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('containers').deleteOne({ userId, name });
        } else {
            await fs.unlink(path.join(DATA_DIR, userId, `${name}.json`)).catch(() => { });
        }
    },

    async listContainers(userId) {
        if (STORE_MODE === 'mongodb') {
            const docs = await db.collection('containers').find({ userId }).project({ name: 1 }).toArray();
            return docs.map(d => d.name);
        } else {
            try {
                const files = await fs.readdir(path.join(DATA_DIR, userId));
                return files.filter(f => f.endsWith('.json') && f !== 'sessions.json' && f !== 'profile.json').map(f => f.replace('.json', ''));
            } catch { return []; }
        }
    },

    async deleteUser(userId) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('users').deleteOne({ userId });
            await db.collection('containers').deleteMany({ userId });
        } else {
            await fsExtra.remove(path.join(DATA_DIR, userId)).catch(() => { });
        }
    },

    async updateUserId(oldId, newId) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('users').updateOne({ userId: oldId }, { $set: { userId: newId } });
            await db.collection('containers').updateMany({ userId: oldId }, { $set: { userId: newId } });
        } else {
            await fsExtra.move(path.join(DATA_DIR, oldId), path.join(DATA_DIR, newId));
        }
    },

    async getSecurity(userId) {
        if (STORE_MODE === 'mongodb') {
            const user = await db.collection('users').findOne({ userId });
            return user?.security || { validation: { GET: true, POST: true, PUT: true, PATCH: true, DELETE: true } };
        } else {
            try {
                return JSON.parse(await fs.readFile(path.join(DATA_DIR, userId, 'security.json'), 'utf8'));
            } catch {
                return { validation: { GET: true, POST: true, PUT: true, PATCH: true, DELETE: true } };
            }
        }
    },

    async updateSecurity(userId, security) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('users').updateOne({ userId }, { $set: { security } }, { upsert: true });
        } else {
            await fsExtra.ensureDir(path.join(DATA_DIR, userId));
            await fs.writeFile(path.join(DATA_DIR, userId, 'security.json'), JSON.stringify(security, null, 2));
        }
    }
};

// ----------------------------------------------------
// Express Middleware
// ----------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Logging Middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const msg = `${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`;
        if (res.statusCode >= 400) logger.warn(msg, { userId: req.userId || 'anonymous' });
        else logger.info(msg, { userId: req.userId || 'anonymous' });
    });
    next();
});

// Auth Helpers
const renderError = (res, status, message) => {
    if (res.req.headers['accept']?.includes('text/html')) {
        return res.status(status).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>Error - JDM Mock</title><style>body{background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.card{background:#1e293b;padding:2rem;border-radius:12px;text-align:center;border:1px solid #334155;}</style></head>
            <body><div class="card"><h1>${status === 401 ? '🔒 Access Denied' : '⚠️ Error'}</h1><p>${message}</p><a href="/index.html" style="color:#3b82f6;">Go to Dashboard</a></div></body>
            </html>
        `);
    }
    return res.status(status).json({ error: message });
};

// ----------------------------------------------------
// Authentication Middleware & Custom Routing
// ----------------------------------------------------
const authenticateAndRoute = async (req, res, next) => {
    const normalizedPath = (req.path.replace(/\/$/, '') || '/').toLowerCase();

    // 1. Management/Public Routes to SKIP
    const skipPaths = [
        '/auth/register', '/auth/login', '/auth/dev-login', '/dev-admin',
        '/favicon.ico', '/admin.html', '/admin-app.js', '/admin-style.css',
        '/crud-example', '/index.html', '/app.js', '/style.css', '/docs', '/admin/logs'
    ];
    if (skipPaths.includes(normalizedPath) || normalizedPath.startsWith('/public/')) {
        return next();
    }

    // 2. Extract Identity (API Key or JWT)
    let userId = req.headers['x-user-id'];
    const apiKey = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.cookies.auth_token;

    if (apiKey === userId && apiKey) {
        req.userId = userId;
        req.userRole = 'admin';
    } else if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.userId = decoded.userId;
            req.userRole = decoded.role;
            userId = decoded.userId;
        } catch (e) {
            // Only error if validation is forced (checked later)
        }
    }

    // Resolve userId if not yet set (fallback to header for context)
    if (!req.userId && userId) {
        req.userId = userId;
    }

    if (!req.userId) {
        return renderError(res, 401, 'Unauthorized: Missing User Context (x-user-id or Token)');
    }

    // 2.1 Selective Token Validation check
    // We MUST use req.userId here to fetch the correct user's settings from MongoDB
    const security = await Storage.getSecurity(req.userId);
    const method = req.method.toUpperCase();
    const isValidationRequired = security.validation[method] !== false;

    if (isValidationRequired && !req.userRole) {
        return renderError(res, 401, `Unauthorized: Token required for ${method} requests.`);
    }

    // 3. Custom Path Resolution (Intercept BEFORE standard data routes)
    // CRITICAL: Skip re-routing for internal management sub-routes
    if (req.path.endsWith('/custom-paths') || req.path.endsWith('/schema-definition') || req.path.endsWith('/rename') || req.path.endsWith('/schema')) {
        return next();
    }

    try {
        const containers = await Storage.listContainers(req.userId);
        for (const container of containers) {
            const data = await Storage.readContainer(req.userId, container);
            if (!data) continue;

            for (const [table, tableData] of Object.entries(data)) {
                if (tableData && typeof tableData === 'object' && !Array.isArray(tableData)) {
                    if (tableData._customPaths) {
                        const method = req.method.toLowerCase();
                        let customPath = tableData._customPaths[method];
                        if (!customPath) continue;
                        if (!customPath.startsWith('/')) customPath = '/' + customPath;

                        let targetUrl = null;
                        if (req.path === customPath) {
                            targetUrl = `/${container}/${table}`;
                        } else if (req.path.startsWith(customPath + '/')) {
                            const id = req.path.slice(customPath.length + 1);
                            targetUrl = `/${container}/${table}/${id}`;
                        }

                        if (targetUrl) {
                            // console.log(`[DEBUG] Re-routing ${req.method} ${req.path} -> ${targetUrl}`);
                            req.url = targetUrl + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
                            return next();
                        }
                    }
                }
            }
        }
    } catch (err) { }

    next();
};

// HTML Page Routes
app.get('/dev-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crud-example', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs.html')));

app.use(authenticateAndRoute);

// ----------------------------------------------------
// Management Routes
// ----------------------------------------------------

app.post('/auth/register', async (req, res) => {
    const userId = uuidv4();
    if (STORE_MODE === 'mongodb') await db.collection('users').insertOne({ userId, sessions: [], createdAt: new Date() });
    else await fsExtra.ensureDir(path.join(DATA_DIR, userId));
    res.status(201).json({ message: 'Registration successful', 'x-user-id': userId });
});

app.post('/auth/login', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(400).json({ error: 'x-user-id required' });
    const expiresIn = parseInt(req.body.expiresIn) || 3600000;
    const role = req.body.role === 'admin' ? 'admin' : 'viewer';
    const token = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: `${expiresIn}ms` });
    const expiresAt = new Date(Date.now() + expiresIn).toISOString();
    await Storage.saveUserSession(userId, { token, expires_at: expiresAt, role });
    res.json({ token, expires_at: expiresAt, role });
});

app.get('/auth/security', async (req, res) => {
    const security = await Storage.getSecurity(req.userId);
    res.json(security);
});

app.patch('/auth/security', async (req, res) => {
    const { validation } = req.body;
    if (!validation) return res.status(400).json({ error: 'Validation settings required' });
    await Storage.updateSecurity(req.userId, { validation });
    res.json({ message: 'Security settings updated' });
});

app.post('/auth/dev-login', async (req, res) => {
    const { email, password } = req.body;
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    let user = null;
    if (STORE_MODE === 'mongodb') user = await db.collection('users').findOne({ email, password: hashedPassword });
    else {
        const dirs = await fs.readdir(DATA_DIR);
        for (const d of dirs) {
            try {
                const p = JSON.parse(await fs.readFile(path.join(DATA_DIR, d, 'profile.json'), 'utf8'));
                if (p.email === email && p.password === hashedPassword) { user = p; break; }
            } catch { }
        }
    }
    if (!user || user.email !== process.env.ADMIN_EMAIL) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.userId, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, userId: user.userId });
});


app.get('/admin/logs', async (req, res) => res.json(await logger.getLogs(100)));
app.delete('/admin/logs', async (req, res) => res.json({ success: await logger.deleteLogs(req.body.ids) }));

app.get('/introspect', async (req, res) => {
    const payload = { userId: req.userId, storage: {} };
    const containers = await Storage.listContainers(req.userId);
    for (const name of containers) {
        const content = await Storage.readContainer(req.userId, name);
        payload.storage[name] = {};
        if (content) {
            for (const [table, records] of Object.entries(content)) {
                const isStructured = !Array.isArray(records);
                const r = isStructured ? records.records : records;
                payload.storage[name][table] = {
                    count: r.length,
                    data: r, // Include literal records
                    schema: isStructured ? records._schema : null,
                    customPaths: isStructured ? records._customPaths : null,
                    primaryKey: isStructured ? (records._primaryKey || '_id') : '_id'
                };
            }
        }
    }
    res.json(payload);
});

app.get('/containers', async (req, res) => res.json({ containers: await Storage.listContainers(req.userId) }));
app.delete('/containers/:name', async (req, res) => { await Storage.deleteContainer(req.userId, req.params.name); res.status(204).send(); });

// ----------------------------------------------------
// Table Management
// ----------------------------------------------------
app.delete('/:container/:table', async (req, res) => {
    const data = await Storage.readContainer(req.userId, req.params.container);
    if (!data || !data[req.params.table]) return res.status(404).send();
    delete data[req.params.table];
    await Storage.writeContainer(req.userId, req.params.container, data);
    res.status(204).send();
});

app.patch('/:container/:table/custom-paths', async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { container, table } = req.params;
    const { method, path: customPath, remove } = req.body;
    let data = await Storage.readContainer(req.userId, container);
    if (!data || !data[table]) return res.status(404).json({ error: 'Not found' });

    if (Array.isArray(data[table])) data[table] = { _schema: {}, _customPaths: {}, records: data[table] };
    else data[table]._customPaths = data[table]._customPaths || {};

    if (remove) {
        if (typeof remove === 'string') delete data[table]._customPaths[remove.toLowerCase()];
        else if (Array.isArray(remove)) remove.forEach(m => delete data[table]._customPaths[m.toLowerCase()]);
    } else if (method && customPath) {
        data[table]._customPaths[method.toLowerCase()] = customPath;
    }

    await Storage.writeContainer(req.userId, container, data);
    res.json({ message: 'Updated', customPaths: data[table]._customPaths });
});

app.patch('/:container/:table/schema-definition', async (req, res) => {
    const { container, table } = req.params;
    let data = await Storage.readContainer(req.userId, container);
    if (!data || !data[table]) return res.status(404).send();
    if (Array.isArray(data[table])) data[table] = { _schema: {}, records: data[table] };
    const { name, type, remove } = req.body;
    if (remove) delete data[table]._schema[remove];
    else if (name && type) data[table]._schema[name] = type;
    await Storage.writeContainer(req.userId, container, data);
    res.json({ schema: data[table]._schema });
});

app.patch('/:container/:table/primary-key', async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { container, table } = req.params;
    const { primaryKey } = req.body;
    let data = await Storage.readContainer(req.userId, container);
    if (!data || !data[table]) return res.status(404).send();

    if (Array.isArray(data[table])) data[table] = { _schema: {}, _customPaths: {}, _primaryKey: primaryKey, records: data[table] };
    else data[table]._primaryKey = primaryKey;

    await Storage.writeContainer(req.userId, container, data);
    res.json({ message: 'Primary key updated', primaryKey: data[table]._primaryKey });
});

// ----------------------------------------------------
// Data Operations
// ----------------------------------------------------
const getRecords = (t) => Array.isArray(t) ? t : t.records;

app.get('/:container/:table', async (req, res) => {
    const data = await Storage.readContainer(req.userId, req.params.container);
    if (!data || !data[req.params.table]) return res.status(404).send();

    let records = getRecords(data[req.params.table]);

    // Filter by query parameters
    const queryKeys = Object.keys(req.query);
    if (queryKeys.length > 0) {
        console.log(`[DEBUG] Filtering records by keys:`, queryKeys);
        records = records.filter(r => {
            return queryKeys.every(k => {
                const val = req.query[k];
                const match = String(r[k]) === String(val);
                console.log(`[DEBUG]   Key: ${k}, RecordVal: ${r[k]}, QueryVal: ${val}, Match: ${match}`);
                return match;
            });
        });
    }

    res.json(records);
});

app.get('/:container/:table/:id', async (req, res) => {
    const data = await Storage.readContainer(req.userId, req.params.container);
    if (!data || !data[req.params.table]) return res.status(404).json({ error: 'Not found' });
    const tableData = data[req.params.table];
    const pk = (!Array.isArray(tableData) ? tableData._primaryKey : null) || '_id';
    const records = getRecords(tableData);
    const r = records.find(x => String(x[pk]) === String(req.params.id));
    if (!r) return res.status(404).json({ error: 'Record not found' });
    res.json(r);
});

app.post('/:container/:table', async (req, res) => {
    let data = await Storage.readContainer(req.userId, req.params.container) || {};
    if (!data[req.params.table]) {
        if (req.body._init) {
            data[req.params.table] = { _schema: req.body._schema || {}, _customPaths: req.body._customPaths || {}, records: [] };
            await Storage.writeContainer(req.userId, req.params.container, data);
            return res.status(201).json({ message: 'Initialized' });
        }
        data[req.params.table] = [];
    }
    const isStructured = !Array.isArray(data[req.params.table]);
    const records = isStructured ? data[req.params.table].records : data[req.params.table];
    const tableData = isStructured ? data[req.params.table] : {};

    // Resolve primary key
    const pk = tableData._primaryKey || '_id';

    const newRecord = { [pk]: uuidv4(), ...req.body };
    delete newRecord._init; delete newRecord._schema; delete newRecord._customPaths;
    records.push(newRecord);
    await Storage.writeContainer(req.userId, req.params.container, data);
    res.status(201).json(newRecord);
});

app.put('/:container/:table/:id', async (req, res) => {
    const data = await Storage.readContainer(req.userId, req.params.container);
    if (!data || !data[req.params.table]) return res.status(404).send();
    const tableData = data[req.params.table];
    const pk = (!Array.isArray(tableData) ? tableData._primaryKey : null) || '_id';
    const records = getRecords(tableData);
    const idx = records.findIndex(x => String(x[pk]) === String(req.params.id));
    if (idx === -1) return res.status(404).send();

    records[idx] = { ...req.body, [pk]: req.params.id };
    await Storage.writeContainer(req.userId, req.params.container, data);
    res.json(records[idx]);
});

app.patch('/:container/:table/:id', async (req, res) => {
    const data = await Storage.readContainer(req.userId, req.params.container);
    if (!data || !data[req.params.table]) return res.status(404).send();
    const tableData = data[req.params.table];
    const pk = (!Array.isArray(tableData) ? tableData._primaryKey : null) || '_id';
    const records = getRecords(tableData);
    const idx = records.findIndex(x => String(x[pk]) === String(req.params.id));
    if (idx === -1) return res.status(404).send();

    records[idx] = { ...records[idx], ...req.body, [pk]: req.params.id };
    await Storage.writeContainer(req.userId, req.params.container, data);
    res.json(records[idx]);
});

app.delete('/:container/:table/:id', async (req, res) => {
    const data = await Storage.readContainer(req.userId, req.params.container);
    if (!data || !data[req.params.table]) return res.status(404).send();
    const tableData = data[req.params.table];
    const pk = (!Array.isArray(tableData) ? tableData._primaryKey : null) || '_id';
    const records = getRecords(tableData);
    const idx = records.findIndex(x => String(x[pk]) === String(req.params.id));
    if (idx === -1) return res.status(404).send();
    records.splice(idx, 1);
    await Storage.writeContainer(req.userId, req.params.container, data);
    res.status(204).send();
});

app.use((err, req, res, next) => {
    logger.error(err.message);
    res.status(500).json({ error: 'Internal Error', message: err.message });
});

const startServer = async () => {
    await Storage.init();
    app.listen(PORT, () => console.log(`🚀 JDM MOCK ${JDM_VERSION} on port ${PORT}`));
};
startServer().catch(console.error);