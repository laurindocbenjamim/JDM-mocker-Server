#!/usr/bin/env node

const express = require('express');
const fs = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
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
                
                // CRITICAL: Force a ping to confirm connection is actually alive
                await mongoClient.db("admin").command({ ping: 1 });
                
                db = mongoClient.db();
                console.log('📦 Connected to MongoDB Atlas successfully.');
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
            // Upsert creates the user document if it doesn't exist
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
    }
};

// ----------------------------------------------------
// Express Middleware
// ----------------------------------------------------
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Authentication Middleware
const authenticate = async (req, res, next) => {
    const authPaths = ['/auth/register', '/auth/login'];
    if (authPaths.includes(req.path)) return next();

    const userId = req.headers['x-user-id'];
    const token = req.headers['authorization']?.split(' ')[1] || req.cookies.auth_token;

    if (!userId || !token) return res.status(401).json({ error: 'Unauthorized: Missing ID or Token' });

    try {
        // Verify the JWT signature 
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Ensure the token belongs to the claiming userId
        if (decoded.userId !== userId) throw new Error('Token mismatch');

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
    // In MongoDB mode, we don't need to write a file; just return the ID
    // The first login/save will create the record in Atlas
    res.status(201).json({ message: 'Registration successful', 'x-user-id': userId });
});

app.post('/auth/login', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });

    const role = req.body.role === 'admin' ? 'admin' : 'viewer';
    const expiresIn = req.body.expiresIn || 3600 * 1000;

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
    const sessions = await Storage.getUserSessions(req.userId);
    res.json({ userId: req.userId, role: req.userRole, sessions });
});

// ... (Rest of your CRUD routes using Storage.readContainer and Storage.writeContainer)

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