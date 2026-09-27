# WebApp Sync (GitHub Pages + Supabase)

GitHub Pages liefert HTML, CSS, JavaScript und Bilder aus. Der Browser liest und
schreibt Texte, Quiz-Antworten und Zeichnungen direkt ueber die Supabase REST API.
Die Daten werden in `shared_state` nach Raum-Code getrennt.

## Veroeffentlichung

Aenderungen committen und auf den fuer GitHub Pages konfigurierten Branch pushen.
Die Website benoetigt keinen zusaetzlichen Node.js-Webservice.

## Lokale Vorschau

Mit Python im Projektverzeichnis:

```bash
python -m http.server 3000 --bind 127.0.0.1
```

Anschliessend `http://localhost:3000` oeffnen. Auch die lokale Vorschau verwendet
die in `script.js` konfigurierte Supabase-Verbindung.

## Bestehende alternative Serverimplementierung

`server.js` ist eine separate PostgreSQL-API, die das aktuelle Frontend nicht
verwendet. Sie ist fuer GitHub Pages nicht erforderlich. `npm start` startet
diese alternative API und benoetigt weiterhin eine gueltige `DATABASE_URL`.

Die SQL-Dateien unter `migrations/` bleiben fuer die Datenbank erhalten.
