# WebApp Sync (Render + Postgres)

Diese Version synchronisiert Texte, Quiz-Antworten und Zeichnungen zwischen Geraeten ueber einen zentralen Server.

## Voraussetzungen

- Node.js 18+
- PostgreSQL (z. B. Supabase)
- Environment Variables:
  - `DATABASE_URL`

## Lokal starten

```bash
npm install
set DATABASE_URL=postgres://USER:PASS@HOST:5432/DB
npm start
```

Browser: `http://localhost:3000`

## Render Deploy

1. Repository nach GitHub pushen.
2. In Render einen **Web Service** erstellen.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment Variables setzen:
   - `DATABASE_URL`

Danach laufen Frontend und API auf derselben Domain.

## API

- `GET /api/state` -> kompletter Zustand (ohne Passcode lesbar)
- `PUT /api/state/:key` -> schreibt genau einen Key
- `GET /health` -> Healthcheck inkl. DB-Check

## Sicherheit

- Soft-Rate-Limit fuer Writes: 60 Requests/Minute/IP.
- Groesse pro Value ist auf 20 MB begrenzt.
