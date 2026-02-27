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
const { MongoClient } = require('mongodb'); // Added MongoDB
require('dotenv').config(); // Load .env variables

// CLI configuration
program
    .option('-p, --port <number>', 'Port to run the server on', process.env.PORT || '3000')
    .option('-d, --db-dir <path>', 'Data directory for JSON files', path.join(process.cwd(), 'data'))
    .option('--ssl', 'Enable HTTPS/SSL using server.key and server.cert', false);
program.parse(process.argv);

const options = program.opts();
const PORT = parseInt(options.port, 10);
const DATA_DIR = path.resolve(options.dbDir || options.dir || path.join(process.cwd(), 'data'));
const STORE_MODE = process.env.STORE_DATA_IN || 'local'; // 'local' or 'mongodb'

const app = express();
const MAX_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB

let forceSecureCookies = false;
let mongoClient = null;
let db = null;

// ----------------------------------------------------
// Storage Adapter Interface
// ----------------------------------------------------
const Storage = {
    async init() {
        if (STORE_MODE === 'mongodb') {
            try {
                // 1. Add SSL/TLS options for Atlas
                mongoClient = new MongoClient(process.env.MONGODB_URI, {
                    tls: true,
                    serverSelectionTimeoutMS: 10000 // Increase timeout for cloud
                });
                
                await mongoClient.connect();
                
                // 2. Ping to verify
                await mongoClient.db("admin").command({ ping: 1 });
                
                db = mongoClient.db();
                console.log('📦 Connected to MongoDB Atlas successfully.');
            } catch (err) {
                console.error('❌ MongoDB Atlas Connection Failed!');
                console.error('Error details:', err.message);
                
                // CRITICAL: Exit so you know it's not working
                process.exit(1); 
            }
        } else {
            await fsExtra.ensureDir(DATA_DIR);
            console.log(`📂 Using Local Storage: ${DATA_DIR}`);
        }
    },
    async readContainer(userId, container) {
        if (STORE_MODE === 'mongodb') {
            const collection = db.collection(`${userId}_${container}`);
            const meta = await db.collection('metadata').findOne({ userId, container });
            const docs = await collection.find({}).toArray();
            
            // Reconstruct the JSON structure the app expects
            const result = {};
            if (meta && meta.tables) {
                for (const table of meta.tables) {
                    const tableDocs = docs.filter(d => d._table === table);
                    const schema = (meta.schemas && meta.schemas[table]) ? meta.schemas[table] : null;
                    
                    if (schema) {
                        result[table] = { _schema: schema, records: tableDocs };
                    } else {
                        result[table] = tableDocs;
                    }
                }
            }
            return result;
        } else {
            const filePath = path.join(DATA_DIR, userId, `${container}.json`);
            try {
                const data = await fs.readFile(filePath, 'utf8');
                return JSON.parse(data);
            } catch (err) {
                if (err.code === 'ENOENT') return null;
                throw err;
            }
        }
    },

    async writeContainer(userId, container, data) {
        if (STORE_MODE === 'mongodb') {
            const metaCollection = db.collection('metadata');
            const dataCollection = db.collection(`${userId}_${container}`);
            
            const tables = Object.keys(data);
            const schemas = {};
            
            // Clear existing and rewrite (to mimic atomic file write behavior)
            await dataCollection.deleteMany({});
            
            for (const table of tables) {
                const isStructured = !Array.isArray(data[table]);
                const records = isStructured ? data[table].records : data[table];
                if (isStructured && data[table]._schema) {
                    schemas[table] = data[table]._schema;
                }
                
                if (records.length > 0) {
                    const docsToInsert = records.map(r => ({ ...r, _table: table }));
                    await dataCollection.insertMany(docsToInsert);
                }
            }
            
            await metaCollection.updateOne(
                { userId, container },
                { $set: { tables, schemas, lastModified: new Date() } },
                { upsert: true }
            );
        } else {
            const userDir = path.join(DATA_DIR, userId);
            await fsExtra.ensureDir(userDir);
            const filePath = path.join(userDir, `${container}.json`);
            const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
            await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
            await fs.rename(tempPath, filePath);
        }
    },

    async deleteContainer(userId, container) {
        if (STORE_MODE === 'mongodb') {
            await db.collection(`${userId}_${container}`).drop().catch(() => {});
            await db.collection('metadata').deleteOne({ userId, container });
        } else {
            const filePath = path.join(DATA_DIR, userId, `${container}.json`);
            await fs.unlink(filePath);
        }
    }
};

// ----------------------------------------------------
// Middleware & Helpers
// ----------------------------------------------------

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    const delay = parseInt(process.env.DELAY || '1000', 10);
    setTimeout(next, delay);
});

const getSessions = async (userId) => {
    if (STORE_MODE === 'mongodb') {
        const user = await db.collection('users').findOne({ userId });
        return user ? user.sessions : [];
    } else {
        const filePath = path.join(DATA_DIR, userId, 'sessions.json');
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) { return []; }
    }
};

const saveSessions = async (userId, sessions) => {
    if (STORE_MODE === 'mongodb') {
        await db.collection('users').updateOne(
            { userId },
            { $set: { sessions, lastActive: new Date() } },
            { upsert: true }
        );
    } else {
        const userDir = path.join(DATA_DIR, userId);
        await fsExtra.ensureDir(userDir);
        const filePath = path.join(userDir, 'sessions.json');
        await fs.writeFile(filePath, JSON.stringify(sessions, null, 2));
    }
};

// ... [Auth logic updated to use Storage/Sessions helpers] ...

app.post('/auth/register', async (req, res) => {
    const userId = uuidv4();
    await saveSessions(userId, []);
    res.status(201).json({ message: 'Registration successful', 'x-user-id': userId });
});

app.post('/auth/login', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });

    const role = req.body.role === 'admin' ? 'admin' : 'viewer';
    const expiresInMs = req.body.expiresIn || 3600 * 1000;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

    const sessions = await getSessions(userId);
    sessions.push({ token, expires_at: expiresAt, role });
    await saveSessions(userId, sessions);

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

// Authentication Middleware
app.use(async (req, res, next) => {
    const authPaths = ['/auth/register', '/auth/login', '/config/force-secure-cookies', '/admin/dashboard'];
    if (authPaths.includes(req.path)) return next();

    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Missing x-user-id' });

    let token = req.headers['authorization']?.split(' ')[1] || req.headers['csrf-token'] || req.cookies.auth_token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const sessions = await getSessions(userId);
    const session = sessions.find(s => s.token === token);

    if (!session || new Date(session.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.userId = userId;
    req.userRole = session.role;
    req.userDir = path.join(DATA_DIR, userId); // Keep for local cleanup logic
    next();
});

// ----------------------------------------------------
// Re-routed Data Ops
// ----------------------------------------------------

app.get('/containers', async (req, res) => {
    if (STORE_MODE === 'mongodb') {
        const metas = await db.collection('metadata').find({ userId: req.userId }).toArray();
        res.json({ containers: metas.map(m => m.container) });
    } else {
        const files = await fs.readdir(req.userDir).catch(() => []);
        const containers = files.filter(f => f.endsWith('.json') && f !== 'sessions.json').map(f => f.replace('.json', ''));
        res.json({ containers });
    }
});

app.get('/:container/:table', async (req, res) => {
    const data = await Storage.readContainer(req.userId, req.params.container);
    if (!data || !data[req.params.table]) return res.status(404).json({ error: 'Not found' });
    
    const records = Array.isArray(data[req.params.table]) ? data[req.params.table] : data[req.params.table].records;
    res.json(records);
});

app.post('/:container/:table', async (req, res) => {
    const { container, table } = req.params;
    let data = await Storage.readContainer(req.userId, container) || {};

    if (!data[table]) {
        data[table] = req.body._schema ? { _schema: req.body._schema, records: [] } : [];
        delete req.body._schema;
    }

    const isStructured = !Array.isArray(data[table]);
    const records = isStructured ? data[table].records : data[table];
    const newRecord = { id: uuidv4(), ...req.body };
    
    records.push(newRecord);
    await Storage.writeContainer(req.userId, container, data);
    res.status(201).json(newRecord);
});

app.delete('/containers/:name', async (req, res) => {
    await Storage.deleteContainer(req.userId, req.params.name);
    res.status(204).send();
});

// ... [Remaining CRUD logic converted to Storage.readContainer/writeContainer] ...

const startServer = async () => {
    await Storage.init();
    
    const protocol = options.ssl ? 'https' : 'http';
    const server = options.ssl ? 
        https.createServer({
            key: await fs.readFile('server.key'),
            cert: await fs.readFile('server.cert')
        }, app) : app;

    server.listen(PORT, () => {
        console.log(`🚀 Server running in ${STORE_MODE} mode on ${protocol}://localhost:${PORT}`);
    });
};

startServer().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
});