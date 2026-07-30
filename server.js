require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
// Zwei Geräte im selben WLAN teilen sich meist eine öffentliche IP.
// Zeichnungen erzeugen mehrere Schreibvorgänge, daher genügend Spielraum lassen.
const WRITE_LIMIT_PER_MINUTE = 300;
const writeWindowMs = 60 * 1000;
const writeRate = new Map();

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

function validateStateInput(req, res, next) {
    const key = req.params.key;
    const value = req.body ? req.body.value : undefined;
    const roomKey = req.body ? req.body.roomKey : undefined;

    if (!key || key.length > 180) {
        return res.status(400).json({ error: 'Invalid key.' });
    }
    if (typeof roomKey !== 'string' || roomKey.trim().length < 5 || roomKey.length > 180) {
        return res.status(400).json({ error: 'Invalid room key.' });
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
            room_key TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (room_key, key)
        )
    `);
    await pool.query('ALTER TABLE shared_state ADD COLUMN IF NOT EXISTS room_key TEXT');
    await pool.query("UPDATE shared_state SET room_key = 'legacy' WHERE room_key IS NULL");
    await pool.query('ALTER TABLE shared_state ALTER COLUMN room_key SET NOT NULL');
    await pool.query('ALTER TABLE shared_state DROP CONSTRAINT IF EXISTS shared_state_pkey');
    await pool.query('ALTER TABLE shared_state ADD CONSTRAINT shared_state_pkey PRIMARY KEY (room_key, key)');
}

app.get('/health', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, db: true, at: nowIso() });
    } catch (err) {
        res.status(500).json({ ok: false, db: false, at: nowIso() });
    }
});

app.get('/api/state', async (req, res, next) => {
    const roomKey = typeof req.query.room === 'string' ? req.query.room.trim() : '';
    if (roomKey.length < 5 || roomKey.length > 180) {
        return res.status(400).json({ error: 'Invalid room key.' });
    }
    try {
        const result = await pool.query(
            'SELECT key, value FROM shared_state WHERE room_key = $1',
            [roomKey]
        );
        const state = {};
        for (const row of result.rows) {
            state[row.key] = row.value;
        }
        res.json({ state, updatedAt: nowIso() });
    } catch (err) {
        next(err);
    }
});

app.put('/api/state/:key', writeRateLimit, validateStateInput, async (req, res, next) => {
    const key = req.params.key;
    const value = req.body.value;
    const roomKey = req.body.roomKey.trim();

    try {
        await pool.query(
            `
            INSERT INTO shared_state (room_key, key, value, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (room_key, key)
            DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `,
            [roomKey, key, value]
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
