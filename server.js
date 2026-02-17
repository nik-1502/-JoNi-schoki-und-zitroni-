const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSCODE = process.env.APP_PASSCODE;
const DATABASE_URL = process.env.DATABASE_URL;
const WRITE_LIMIT_PER_MINUTE = 60;
const writeWindowMs = 60 * 1000;
const writeRate = new Map();

if (!APP_PASSCODE) {
    console.error('Missing APP_PASSCODE environment variable.');
    process.exit(1);
}

if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL environment variable.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

app.use(express.json({ limit: '25mb' }));
app.use(express.static(__dirname));

function nowIso() {
    return new Date().toISOString();
}

function getClientIp(req) {
    return (
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
        req.socket.remoteAddress ||
        'unknown'
    );
}

function writeRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    const timestamps = writeRate.get(ip) || [];
    const kept = timestamps.filter((ts) => now - ts < writeWindowMs);

    if (kept.length >= WRITE_LIMIT_PER_MINUTE) {
        return res.status(429).json({ error: 'Too many write requests. Please retry shortly.' });
    }

    kept.push(now);
    writeRate.set(ip, kept);
    next();
}

function requirePasscode(req, res, next) {
    const passcode = req.header('x-app-passcode');
    if (!passcode || passcode !== APP_PASSCODE) {
        return res.status(401).json({ error: 'Invalid passcode.' });
    }
    next();
}

function validateStateInput(req, res, next) {
    const key = req.params.key;
    const value = req.body ? req.body.value : undefined;

    if (!key || key.length > 180) {
        return res.status(400).json({ error: 'Invalid key.' });
    }
    if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Value must be a string.' });
    }
    if (value.length > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'Value too large.' });
    }

    next();
}

async function ensureSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS shared_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

app.get('/health', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, db: true, at: nowIso() });
    } catch (err) {
        res.status(500).json({ ok: false, db: false, at: nowIso() });
    }
});

app.get('/api/state', async (_req, res, next) => {
    try {
        const result = await pool.query('SELECT key, value FROM shared_state');
        const state = {};
        for (const row of result.rows) {
            state[row.key] = row.value;
        }
        res.json({ state, updatedAt: nowIso() });
    } catch (err) {
        next(err);
    }
});

app.put('/api/state/:key', writeRateLimit, requirePasscode, validateStateInput, async (req, res, next) => {
    const key = req.params.key;
    const value = req.body.value;

    try {
        await pool.query(
            `
            INSERT INTO shared_state (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key)
            DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `,
            [key, value]
        );

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

app.use((err, _req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error.' });
});

async function start() {
    await ensureSchema();
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

start().catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
});
