#!/usr/bin/env node

const express = require('express');
const fs = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken'); // Use the library from package.json
const { MongoClient } = require('mongodb');
const { program } = require('commander');
const https = require('https');
const crypto = require('crypto');
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
let db = null;
let mongoClient = null;

// ----------------------------------------------------
// Storage Engine (Supports Atlas & Local)
// ----------------------------------------------------
const Storage = {
    async init() {
        if (STORE_MODE === 'mongodb') {
            try {
                // REQUIRED: Options for Atlas (SSL + Timeout)
                mongoClient = new MongoClient(process.env.MONGODB_URI, {
                    tls: true, // Necessary for MongoDB Atlas
                    serverSelectionTimeoutMS: 5000 // Fails fast if connection is bad
                });

                await mongoClient.connect();
                console.log(`🔌 Attempting connection to: ${process.env.MONGODB_URI.split('@')[1]}`);

                // CRITICAL: Force a ping to confirm connection is actually alive
                await mongoClient.db("admin").command({ ping: 1 });

                // Explicitly use the database name from the URI or default to data_tuning_school
                const urlParts = new URL(process.env.MONGODB_URI);
                const dbName = urlParts.pathname.split('/')[1] || 'data_tuning_school';
                db = mongoClient.db(dbName);
                console.log(`📦 Connected to MongoDB successfully. Database: ${db.databaseName}`);
            } catch (err) {
                console.error('❌ MongoDB Connection Failed!');
                console.error('Error details:', err.message);

                // Stop the server so you know it's not working
                process.exit(1);
            }
        } else {
            await fsExtra.ensureDir(DATA_DIR);
            console.log(`📂 Using Local Storage: ${DATA_DIR}`);
        }

        // Seed Developer User
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
            if (!existing) {
                await db.collection('users').insertOne(devUser);
                console.log(`👤 Developer user seeded in MongoDB`);
            }
        } else {
            const devDir = path.join(DATA_DIR, devUser.userId);
            await fsExtra.ensureDir(devDir);
            const profilePath = path.join(devDir, 'profile.json');
            if (!await fsExtra.pathExists(profilePath)) {
                await fs.writeFile(profilePath, JSON.stringify(devUser, null, 2));
                console.log(`👤 Developer user seeded in Local Storage`);
            }
        }
    },

    async getUserSessions(userId) {
        if (STORE_MODE === 'mongodb') {
            const user = await db.collection('users').findOne({ userId });
            return user ? user.sessions || [] : [];
        } else {
            const sessionPath = path.join(DATA_DIR, userId, 'sessions.json');
            try {
                return JSON.parse(await fs.readFile(sessionPath, 'utf8'));
            } catch { return []; }
        }
    },

    async saveUserSession(userId, sessionData) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('users').updateOne(
                { userId },
                {
                    $push: { sessions: sessionData },
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
            );
        } else {
            const userDir = path.join(DATA_DIR, userId);
            await fsExtra.ensureDir(userDir);
            const sessions = await this.getUserSessions(userId);
            sessions.push(sessionData);
            await fs.writeFile(path.join(userDir, 'sessions.json'), JSON.stringify(sessions, null, 2));
        }
    },

    async readContainer(userId, name) {
        if (STORE_MODE === 'mongodb') {
            const doc = await db.collection('containers').findOne({ userId, name });
            return doc ? doc.data : null;
        } else {
            try {
                const content = await fs.readFile(path.join(DATA_DIR, userId, `${name}.json`), 'utf8');
                return JSON.parse(content);
            } catch { return null; }
        }
    },

    async writeContainer(userId, name, data) {
        if (STORE_MODE === 'mongodb') {
            await db.collection('containers').updateOne(
                { userId, name },
                { $set: { data, updatedAt: new Date() } },
                { upsert: true }
            );
        } else {
            const userDir = path.join(DATA_DIR, userId);
            await fsExtra.ensureDir(userDir);
            await fs.writeFile(path.join(userDir, `${name}.json`), JSON.stringify(data, null, 2));
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
                return files.filter(f => f.endsWith('.json') && f !== 'sessions.json').map(f => f.replace('.json', ''));
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
    }
};

// ----------------------------------------------------
// Express Middleware
// ----------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Custom Mock Route Resolution (Top Level) ---
app.use(async (req, res, next) => {
    // Skip well-known management routes
    const pathsToSkip = [
        '/introspect', '/auth', '/containers', '/admin', '/dev-admin',
        '/crud-example', '/favicon.ico', '/index.html', '/app.js', '/style.css',
        '/assets', '/public', '/reg.log', '/docs'
    ];
    if (pathsToSkip.some(p => req.path.startsWith(p))) return next();

    // In top-level, we need to extract userId and token manually to check custom paths
    let userId = req.headers['x-user-id'];
    if (!userId) {
        const token = req.headers['authorization']?.split(' ')[1] || req.cookies.auth_token;
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                userId = decoded.userId;
            } catch (e) { }
        }
    }

    if (!userId) return next();

    try {
        const containerNames = await Storage.listContainers(userId);
        for (const container of containerNames) {
            const data = await Storage.readContainer(userId, container);
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
                            const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
                            req.url = targetUrl + query;
                            // Re-routing happens internally here
                            return next();
                        }
                    }
                }
            }
        }
    } catch (err) {
        // Silently fail
    }
    next();
});
// Consolidating all dashboard assets to /public

// JWT Authentication Middleware
const renderError = (res, status, message) => {
    if (res.req.headers['accept']?.includes('text/html')) {
        return res.status(status).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Unauthorized - JDM Mocker</title>
                <style>
                    body { background: #0f172a; color: #f8fafc; font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: #1e293b; padding: 2.5rem; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; max-width: 450px; border: 1px solid #334155; }
                    h1 { color: #f87171; font-size: 1.75rem; margin-bottom: 1rem; font-weight: 800; }
                    p { color: #94a3b8; line-height: 1.6; font-size: 0.95rem; }
                    .code { background: #0f172a; padding: 1.25rem; border-radius: 10px; font-family: 'Fira Code', monospace; color: #38bdf8; margin: 1.5rem 0; word-break: break-all; border: 1px solid #1e293b; font-size: 0.85rem; }
                    .btn { display: inline-block; background: #3b82f6; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 1rem; transition: background 0.2s; }
                    .btn:hover { background: #2563eb; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>${status === 401 ? '🔒 Access Denied' : '⚠️ Error'}</h1>
                    <p>It seems you are trying to access a protected JDM resource without a valid session.</p>
                    <div class="code">{"error": "${message}"}</div>
                    <a href="/index.html" class="btn">Go to Dashboard</a>
                </div>
            </body>
            </html>
        `);
    }
    return res.status(status).json({ error: message });
};

const authenticate = async (req, res, next) => {
    const normalizedPath = (req.path.replace(/\/$/, '') || '/').toLowerCase();
    const authPaths = [
        '/auth/register',
        '/auth/login',
        '/dev-admin',
        '/auth/dev-login',
        '/favicon.ico',
        '/admin.html',
        '/admin-app.js',
        '/admin-style.css',
        '/crud-example',
        '/crud-xample', // Failsafe for user typo
        '/index.html',
        '/app.js',
        '/style.css',
        '/docs'
    ];

    if (authPaths.includes(normalizedPath) || normalizedPath.startsWith('/public/')) {
        return next();
    }

    // 1. Identification
    let userId = req.headers['x-user-id'];
    const apiKey = req.headers['x-api-key'];
    const token = req.headers['authorization']?.split(' ')[1] ||
        req.headers['csrf-token'] ||
        req.headers['x-csrf-token'] ||
        req.cookies.auth_token;

    // 2. Authentication logic
    if (apiKey && apiKey === userId) {
        // Direct API Key access
        req.userId = userId;
        req.userRole = 'admin';
        return next();
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            // Derive identity from token if header is missing
            if (!userId) userId = decoded.userId;

            if (decoded.userId !== userId) {
                throw new Error('Token mismatch');
            }
            req.userId = userId;
            req.userRole = decoded.role;
            return next();
        } catch (err) {
            // If token is invalid/expired, we might fall back or error
            if (userId) return renderError(res, 401, 'Invalid or expired session');
        }
    }

    // 3. Final validation
    if (!userId) {
        console.warn(`[AUTH] Blocked ${req.method} ${req.path} - Missing Identity`);
        return renderError(res, 401, 'Unauthorized: Missing User ID or valid Session');
    }

    console.warn(`[AUTH] Blocked ${req.method} ${req.path} - Forbidden for User ${userId}`);
    return renderError(res, 401, 'Unauthorized: Access Denied');
};

// ----------------------------------------------------
// Auth Routes
// ----------------------------------------------------

app.post('/auth/register', async (req, res) => {
    const userId = uuidv4();
    if (STORE_MODE === 'mongodb') {
        // Initialize user in MongoDB
        await db.collection('users').insertOne({ userId, sessions: [], createdAt: new Date() });
    } else {
        const userDir = path.join(DATA_DIR, userId);
        await fsExtra.ensureDir(userDir);
        await fs.writeFile(path.join(userDir, 'sessions.json'), '[]');
    }
    res.status(201).json({ message: 'Registration successful', 'x-user-id': userId });
});

app.post('/auth/login', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });

    const requestedRole = (req.body.role || '').toLowerCase();
    const role = requestedRole === 'admin' ? 'admin' : 'viewer';

    // Default expiration from env or 1 hour
    const defaultExpire = parseInt(process.env.SESSION_EXPIRE, 10) || (3600 * 1000);
    const expiresIn = req.body.expiresIn || defaultExpire;

    // Create a secure JWT instead of random hex 
    const token = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: `${expiresIn}ms` });
    const expiresAt = new Date(Date.now() + expiresIn).toISOString();

    const sessionData = { token, expires_at: expiresAt, role };
    await Storage.saveUserSession(userId, sessionData);

    res.json({ message: 'Login successful', token, expires_at: expiresAt, role });
});

app.post('/auth/dev-login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    let user = null;
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    if (STORE_MODE === 'mongodb') {
        user = await db.collection('users').findOne({ email, password: hashedPassword });
    } else {
        // Simple scan for local (slow but dev only)
        const dirs = await fs.readdir(DATA_DIR);
        for (const d of dirs) {
            try {
                const profile = JSON.parse(await fs.readFile(path.join(DATA_DIR, d, 'profile.json'), 'utf8'));
                if (profile.email === email && profile.password === hashedPassword) {
                    user = profile;
                    break;
                }
            } catch { }
        }
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!user || user.email !== adminEmail) {
        return res.status(401).json({ error: 'Invalid developer credentials' });
    }

    const token = jwt.sign({ userId: user.userId, role: 'admin', email: user.email }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ message: 'Developer login successful', token, userId: user.userId });
});

// Route to serve Admin Dashboard
app.get('/dev-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Route to serve Client CRUD Example
app.get('/crud-example', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route to serve Modern Documentation
app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

app.use(authenticate);

// Custom resolution moved to top for better re-routing

// ----------------------------------------------------
// Data Routes (Simplified for brevity)
// ----------------------------------------------------

app.get('/introspect', async (req, res) => {
    try {
        const payload = {
            userId: req.userId,
            role: req.userRole,
            sessions: await Storage.getUserSessions(req.userId),
            storage: {}
        };

        const containerNames = await Storage.listContainers(req.userId);
        for (const name of containerNames) {
            const content = await Storage.readContainer(req.userId, name);
            payload.storage[name] = {};
            if (content) {
                for (const [table, records] of Object.entries(content)) {
                    const isStructured = !Array.isArray(records);
                    const tableRecords = isStructured ? records.records : records;
                    payload.storage[name][table] = {
                        count: Array.isArray(tableRecords) ? tableRecords.length : 0,
                        schema_preview: Array.isArray(tableRecords) && tableRecords.length > 0 ? Object.keys(tableRecords[0]) : [],
                        schema: isStructured ? records._schema : null,
                        customPaths: isStructured ? records._customPaths : null,
                        data: tableRecords
                    };
                }
            }
        }
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: 'Introspection failed' });
    }
});

app.patch('/auth/update-uuid', async (req, res) => {
    const newUserId = uuidv4();
    try {
        await Storage.updateUserId(req.userId, newUserId);

        // Issue a NEW token for the NEW identity
        const token = jwt.sign({ userId: newUserId, role: req.userRole }, JWT_SECRET, { expiresIn: '1h' });

        // Also update the session in storage if needed (but JWT is stateless anyway)
        await Storage.saveUserSession(newUserId, { token, expires_at: new Date(Date.now() + 3600000).toISOString(), role: req.userRole });

        res.json({
            message: 'UUID updated successfully',
            'x-user-id': newUserId,
            token
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update UUID' });
    }
});

app.delete('/auth/account', async (req, res) => {
    try {
        await Storage.deleteUser(req.userId);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

app.get('/admin/stats', async (req, res) => {
    // Verified via 'admin' role in derived token
    if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Developer access only' });
    }

    try {
        const summary = { totalUsers: 0, totalContainers: 0, totalTables: 0, totalColumns: 0 };

        if (STORE_MODE === 'mongodb') {
            const users = await db.collection('users').find().toArray();
            summary.totalUsers = users.length;

            const stats = await Promise.all(users.map(async (user) => {
                const containers = await db.collection('containers').find({ userId: user.userId }).toArray();
                let userTableCount = 0;
                let userColumnCount = 0;

                containers.forEach(c => {
                    const tables = Object.keys(c.data || {});
                    userTableCount += tables.length;
                    tables.forEach(tableName => {
                        const tableData = c.data[tableName];
                        if (tableData && typeof tableData === 'object' && !Array.isArray(tableData)) {
                            // Structured format: count columns from schema
                            if (tableData._schema) userColumnCount += Object.keys(tableData._schema).length;
                        } else if (Array.isArray(tableData) && tableData.length > 0) {
                            // Legacy format: count from first record
                            userColumnCount += Object.keys(tableData[0]).length;
                        }
                    });
                });

                summary.totalContainers += containers.length;
                summary.totalTables += userTableCount;
                summary.totalColumns += userColumnCount;

                return {
                    userId: user.userId,
                    name: user.name || 'Anonymous',
                    email: user.email || 'N/A',
                    createdAt: user.createdAt,
                    containerCount: containers.length,
                    tableCount: userTableCount
                };
            }));

            // Sort by createdAt DESC
            stats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            res.json({ summary, details: stats });
        } else {
            const userDirs = (await fs.readdir(DATA_DIR)).filter(d => {
                try { return fsExtra.statSync(path.join(DATA_DIR, d)).isDirectory(); } catch { return false; }
            });
            summary.totalUsers = userDirs.length;

            const stats = await Promise.all(userDirs.map(async (userId) => {
                const userPath = path.join(DATA_DIR, userId);
                const files = await fs.readdir(userPath);
                const containers = files.filter(f => f.endsWith('.json') && f !== 'sessions.json' && f !== 'profile.json');

                let userTableCount = 0;
                let userColumnCount = 0;
                let profile = {};
                try { profile = JSON.parse(await fs.readFile(path.join(userPath, 'profile.json'), 'utf8')); } catch { }

                await Promise.all(containers.map(async (cFile) => {
                    try {
                        const content = JSON.parse(await fs.readFile(path.join(userPath, cFile), 'utf8'));
                        const tables = Object.keys(content);
                        userTableCount += tables.length;
                        tables.forEach(tableName => {
                            const tableData = content[tableName];
                            if (tableData && typeof tableData === 'object' && !Array.isArray(tableData)) {
                                if (tableData._schema) userColumnCount += Object.keys(tableData._schema).length;
                            } else if (Array.isArray(tableData) && tableData.length > 0) {
                                userColumnCount += Object.keys(tableData[0]).length;
                            }
                        });
                    } catch { }
                }));

                const stat = await fs.stat(userPath);

                summary.totalContainers += containers.length;
                summary.totalTables += userTableCount;
                summary.totalColumns += userColumnCount;

                return {
                    userId,
                    name: profile.name || profile.userId || 'Anonymous',
                    email: profile.email || 'N/A',
                    createdAt: profile.createdAt || stat.birthtime,
                    containerCount: containers.length,
                    tableCount: userTableCount
                };
            }));

            // Sort by createdAt DESC
            stats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            res.json({ summary, details: stats });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});

app.delete('/admin/users/:id', async (req, res) => {
    // Verified via 'admin' role in derived token
    if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    await Storage.deleteUser(req.params.id);
    res.status(204).send();
});

app.post('/admin/users/bulk-delete', async (req, res) => {
    if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds array required' });

    try {
        await Promise.all(userIds.map(id => Storage.deleteUser(id)));
        res.status(200).json({ message: `Successfully removed ${userIds.length} users` });
    } catch (err) {
        res.status(500).json({ error: 'Bulk deletion failed' });
    }
});

app.get('/containers', async (req, res) => {
    try {
        const containers = await Storage.listContainers(req.userId);
        res.json({ containers });
    } catch (err) {
        res.status(500).json({ error: 'Error reading containers' });
    }
});

app.delete('/containers/:name', async (req, res) => {
    try {
        await Storage.deleteContainer(req.userId, req.params.name);
        res.status(204).send();
    } catch (err) {
        res.status(404).json({ error: 'Container not found' });
    }
});

// ----------------------------------------------------
// Table Ops
// ----------------------------------------------------

app.delete('/:container/:table', async (req, res) => {
    const { container, table } = req.params;
    const data = await Storage.readContainer(req.userId, container);

    if (!data || !data[table]) return res.status(404).json({ error: `Table '${table}' not found` });

    delete data[table];
    await Storage.writeContainer(req.userId, container, data);
    res.status(204).send();
});

app.patch('/:container/:table/rename', async (req, res) => {
    const { container, table } = req.params;
    const { newName } = req.body;

    if (!newName) return res.status(400).json({ error: 'Bad Request: newName required' });

    const data = await Storage.readContainer(req.userId, container);

    if (!data || !data[table]) return res.status(404).json({ error: `Table '${table}' not found` });
    if (data[newName]) return res.status(400).json({ error: `Table '${newName}' already exists` });

    data[newName] = data[table];
    delete data[table];
    await Storage.writeContainer(req.userId, container, data);

    res.json({ message: `Table renamed to '${newName}'` });
});

app.patch('/:container/:table/schema', async (req, res) => {
    const { container, table } = req.params;
    const { remove, rename, set } = req.body;

    const data = await Storage.readContainer(req.userId, container);

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

    await Storage.writeContainer(req.userId, container, data);
    res.json({ message: `Schema bulk update applied`, count: updatedRecords.length });
});

app.patch('/:container/:table/schema-definition', async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Forbidden: Admin role required for mutation' });
    const { container, table } = req.params;
    const { name, type, remove } = req.body;

    const data = await Storage.readContainer(req.userId, container);
    if (!data || !data[table]) return res.status(404).json({ error: `Table '${table}' not found` });

    if (!Array.isArray(data[table])) {
        data[table]._schema = data[table]._schema || {};
        if (remove) {
            delete data[table]._schema[remove];
        } else if (name && type) {
            if (data[table]._schema[name]) {
                return res.status(400).json({ error: `Column '${name}' already exists in table '${table}'` });
            }
            data[table]._schema[name] = type;
        }
    } else {
        // Convert to structured if needed? or just fail for now
        if (name && type) {
            data[table] = {
                _schema: { [name]: type },
                records: data[table]
            };
        }
    }

    await Storage.writeContainer(req.userId, container, data);
    res.json({ message: 'Schema definition updated successfully', schema: data[table]._schema || {} });
});

// ----------------------------------------------------
// Data Ops (Full CRUD on /:container/:table & ID)
// ----------------------------------------------------

const getTableRecords = (tableData) => {
    if (!tableData) return null;
    return Array.isArray(tableData) ? tableData : tableData.records;
};

const validateAgainstSchema = (payload, schema) => {
    if (!schema || Object.keys(schema).length === 0) return null;

    for (const [key, type] of Object.entries(schema)) {
        const val = payload[key];
        if (val === undefined || val === null) continue;

        if (type === 'String' && typeof val !== 'string') return `Field '${key}' expects String`;
        if (type === 'Number' && typeof val !== 'number') return `Field '${key}' expects Number`;
        if (type === 'Boolean' && typeof val !== 'boolean') return `Field '${key}' expects Boolean`;
        if (type === 'Date' && isNaN(Date.parse(val))) return `Field '${key}' expects a valid ISO Date string`;
    }
    return null;
};

app.get('/:container/:table', async (req, res) => {
    const { container, table } = req.params;
    const data = await Storage.readContainer(req.userId, container);

    if (!data || !data[table]) return res.status(404).json({ error: `Table '${table}' not found` });

    let records = getTableRecords(data[table]);

    const { page, limit, ...filters } = req.query;
    if (Object.keys(filters).length > 0) {
        records = records.filter(record => {
            return Object.entries(filters).every(([k, v]) => String(record[k]) === String(v));
        });
    }

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
    const data = await Storage.readContainer(req.userId, container);

    if (!data || !data[table]) return res.status(404).json({ error: 'Table not found' });

    const records = getTableRecords(data[table]);
    const record = records.find(r => r.id === id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    res.json(record);
});

app.post('/:container/:table', async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Forbidden: Admin role required for mutation' });
    const { container, table } = req.params;
    let data = await Storage.readContainer(req.userId, container) || {};

    if (!data[table] && req.body._schema) {
        data[table] = {
            _schema: req.body._schema,
            _customPaths: req.body._customPaths || {},
            records: []
        };
        delete req.body._schema;
        delete req.body._customPaths;
        if (Object.keys(req.body).length === 0) {
            await Storage.writeContainer(req.userId, container, data);
            return res.status(201).json({ message: 'Table initialized with schema' });
        }
    } else if (!data[table]) {
        if (req.body._init) {
            data[table] = {
                _schema: req.body._schema || {},
                _customPaths: req.body._customPaths || {},
                records: []
            };
            delete req.body._schema;
            delete req.body._customPaths;
            delete req.body._init;
            await Storage.writeContainer(req.userId, container, data);
            return res.status(201).json({ message: 'Table initialized' });
        }
        data[table] = [];
    } else if (req.body._init) {
        return res.status(400).json({ error: `Table '${table}' already exists in container '${container}'` });
    }

    const isStructured = !Array.isArray(data[table]);
    const schema = isStructured ? data[table]._schema : null;
    const records = isStructured ? data[table].records : data[table];

    delete req.body._schema;

    if (schema) {
        const validationError = validateAgainstSchema(req.body, schema);
        if (validationError) return res.status(400).json({ error: `Validation Error: ${validationError}` });
    }

    const newRecord = { id: uuidv4(), ...req.body };
    records.push(newRecord);

    await Storage.writeContainer(req.userId, container, data);
    res.status(201).json(newRecord);
});

app.put('/:container/:table/:id', async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Forbidden: Admin role required for mutation' });
    const { container, table, id } = req.params;
    const data = await Storage.readContainer(req.userId, container);

    if (!data || !data[table]) return res.status(404).json({ error: 'Table not found' });

    const isStructured = !Array.isArray(data[table]);
    const schema = isStructured ? data[table]._schema : null;
    const records = isStructured ? data[table].records : data[table];

    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    if (schema) {
        delete req.body._schema;
        const validationError = validateAgainstSchema(req.body, schema);
        if (validationError) return res.status(400).json({ error: `Validation Error: ${validationError}` });
    }

    records[idx] = { id, ...req.body };
    await Storage.writeContainer(req.userId, container, data);

    res.json(records[idx]);
});

app.delete('/:container/:table/:id', async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ error: 'Forbidden: Admin role required for mutation' });
    const { container, table, id } = req.params;
    const data = await Storage.readContainer(req.userId, container);

    if (!data || !data[table]) return res.status(404).json({ error: 'Table not found' });

    const isStructured = !Array.isArray(data[table]);
    const records = isStructured ? data[table].records : data[table];

    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    records.splice(idx, 1);
    await Storage.writeContainer(req.userId, container, data);
    res.status(204).send();
});

app.patch('/:container/:table/:id', async (req, res) => {
    const { container, table, id } = req.params;
    const data = await Storage.readContainer(req.userId, container);

    if (!data || !data[table]) return res.status(404).json({ error: 'Table not found' });

    const isStructured = !Array.isArray(data[table]);
    const schema = isStructured ? data[table]._schema : null;
    const records = isStructured ? data[table].records : data[table];

    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    if (schema) {
        delete req.body._schema;
        // For PATCH, we only validate the fields present in req.body
        const validationError = validateAgainstSchema(req.body, schema);
        if (validationError) return res.status(400).json({ error: `Validation Error: ${validationError}` });
    }

    records[idx] = { ...records[idx], ...req.body, id }; // Ensure ID is preserved
    await Storage.writeContainer(req.userId, container, data);

    res.json(records[idx]);
});

// ----------------------------------------------------
// Server Startup
// ----------------------------------------------------
const startServer = async () => {
    await Storage.init();

    const server = options.ssl ?
        https.createServer({
            key: await fs.readFile('server.key'),
            cert: await fs.readFile('server.cert')
        }, app) : app;

    server.listen(PORT, () => {
        console.log(`🚀 JDM Mocker ${JDM_VERSION} running in ${STORE_MODE} mode on http${options.ssl ? 's' : ''}://localhost:${PORT}`);
    });
};

startServer().catch(console.error);