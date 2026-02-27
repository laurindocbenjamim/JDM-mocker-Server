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

// JWT Authentication Middleware
const authenticate = async (req, res, next) => {
    const authPaths = ['/auth/register', '/auth/login'];
    if (authPaths.includes(req.path)) return next();

    const userId = req.headers['x-user-id'];
    const apiKey = req.headers['x-api-key'];
    const token = req.headers['authorization']?.split(' ')[1] ||
        req.headers['csrf-token'] ||
        req.headers['x-csrf-token'] ||
        req.cookies.auth_token;

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: Missing User ID' });
    }

    // Allow terminal/API access if x-api-key matches userId
    if (apiKey === userId) {
        req.userId = userId;
        req.userRole = 'admin'; // Grant admin for direct API key access
        return next();
    }

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Missing Token' });
    }

    try {
        // Verify the JWT signature
        const decoded = jwt.verify(token, JWT_SECRET);

        // Ensure the token belongs to the claiming userId
        if (decoded.userId !== userId) {
            throw new Error('Token mismatch');
        }

        req.userId = userId;
        req.userRole = decoded.role;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
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

app.use(authenticate);

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
    const { container, table } = req.params;
    let data = await Storage.readContainer(req.userId, container) || {};

    if (!data[table] && req.body._schema) {
        data[table] = { _schema: req.body._schema, records: [] };
        delete req.body._schema;
        if (Object.keys(req.body).length === 0) {
            await Storage.writeContainer(req.userId, container, data);
            return res.status(201).json({ message: 'Table initialized with schema' });
        }
    } else if (!data[table]) {
        data[table] = [];
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
        console.log(`🚀 Server running in ${STORE_MODE} mode on http${options.ssl ? 's' : ''}://localhost:${PORT}`);
    });
};

startServer().catch(console.error);