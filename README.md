# Zeiterfassung – Webapp (HTML/CSS/JS) + n8n + Google Sheets

Leichte Web-App für Mitarbeiter-Zeiterfassung mit **sekundengenauem** Tracking.
Login via **Mitarbeiter-ID** (aus Google Sheets), Check-in/Check-out und **Pause stechen**, plus **manuelle Nachträge**.
Die Daten werden via **n8n** in ein Google Spreadsheet geschrieben bzw. aktualisiert.

---

## Features

* Mitarbeiter-Login mit **ID-Prüfung** gegen Tabellenblatt `Mitarbeiter` (über n8n)
* Live-Timer für **Arbeitszeit** und **Pausenzeit**
* **Pause starten/beenden** – sekundengenau
* **Gesetzliche Mindestpausen** werden beim Check-out automatisch aufgefüllt
  (Standard: > 6 h → 30 min, > 8 h → 45 min – konfigurierbar)
* **Manuelle Erfassung** (Datum/Start/Ende/Pause/Beschreibung) – Zeiten als `HH:MM:SS`
* **Erfassungs-ID** als eindeutiger Schlüssel:
  `YYYY-MM-DD_<Mitarbeiter-ID>_<Start-HHMMSS>` – wird für Updates genutzt; unterschiedliche Startzeiten → neue Zeilen
* **Lokale Persistenz** (LocalStorage): Login-User, Arbeitsstart, Pausen-Summe

---

## Architektur & Datenfluss

1. **Login**
   App schickt `POST /webhook/check-mitarbeiter` → n8n liest `Mitarbeiter`-Sheet → Antwort `{exists, matchId, vorname, nachname}`.

2. **Arbeitsbeginn / Pausen / Checkout**
   App verwaltet Timer lokal. Beim Check-out sendet sie `PUT /webhook/zeiterfassung` mit
   `{date, start, end, pause, description, id, vorname, nachname}` (alle Zeiten `HH:MM:SS`).

3. **n8n Workflow „Zeiterfassung“**

   * `Webhook (zeiterfassung)` → `Function (Erfassungs-ID generieren)`
   * `Google Sheets: Zeiterfassung lesen` → `Function (Prüfe ob ID existiert)`
   * `IF`:

     * **true** → `Aktualisiere Zeiten` (frühester Start, spätester End) → `Google Sheets: Update (key=Erfassungs-ID)`
     * **false** → `Berechne neue Zeiten` → `Google Sheets: Append`

---

## Projektstruktur

```
/ (statisches Hosting)
├─ index.html
├─ style.css
└─ script.js
```

---

## Voraussetzungen

* **n8n** v1.95.3 (wie im Projekt im Einsatz)
* **Google Sheets** mit zwei Tabellenblättern:

  * `Mitarbeiter` mit Spalten: `Mitarbeiter-ID` (als Text formatiert, z. B. `0001`), `Vorname`, `Nachname`
  * `Zeiterfassung` mit Spalten (Beispiel):
    `Datum, Startzeit, Endzeit, Pause, Beschreibung, Arbeitsstunden, Mitarbeiter-ID, Vorname, Nachname, Erfassungs-ID`
* **Google Sheets OAuth2** in n8n eingerichtet

---

## Einrichtung

### 1) Google Sheets vorbereiten

* Tab **Mitarbeiter** anlegen:

  ```
  Mitarbeiter-ID | Vorname | Nachname
  0001           | Max     | Mustermann
  4002           | Anna    | Beispiel
  ```

  👉 **Wichtig:** `Mitarbeiter-ID` als **Text** formatieren, um führende Nullen zu behalten.

* Tab **Zeiterfassung** anlegen mit Spalten:
  `Datum, Startzeit, Endzeit, Pause, Beschreibung, Arbeitsstunden, Mitarbeiter-ID, Vorname, Nachname, Erfassungs-ID`

### 2) n8n Workflows

* **Workflow A: Mitarbeiter-Check**

  * `Webhook (POST /webhook/check-mitarbeiter)`
  * `Google Sheets: Read (Mitarbeiter)`
  * `Function: exakte ID-Suche (== auf Spalte "Mitarbeiter-ID")`
  * `Respond to Webhook`: `{ exists, matchId, vorname, nachname }`

* **Workflow B: Zeiterfassung**

  * `Webhook (PUT /webhook/zeiterfassung)`
  * `Function: Erfassungs-ID generieren`

    * bildet `Erfassungs-ID = date + "_" + id + "_" + start(HHMMSS)`
  * `Google Sheets: Read (Zeiterfassung)`
  * `Function: Prüfe ob ID existiert` (Sucht `Erfassungs-ID`, liefert `rowIndex` oder `null`)
  * `IF rowIndex exists?`

    * **true**: `Aktualisiere Zeiten` → `Google Sheets: Update (key=Erfassungs-ID)`
    * **false**: `Berechne neue Zeiten` → `Google Sheets: Append`

> Hinweis: Du hast diese Workflows bereits – achte darauf, dass **alle Zeiten mit Sekunden** kommen und die **Erfassungs-ID** die Sekundenteile enthält.

### 3) Webapp konfigurieren

In `script.js` die Endpoints ggf. anpassen:

```js
const WEBHOOK_URL = "https://<dein-n8n>/webhook/zeiterfassung";
const CHECK_URL   = "https://<dein-n8n>/webhook/check-mitarbeiter";
```

In `index.html` sicherstellen, dass die **Zeit-Inputs Sekunden erlauben**:

```html
<input type="time" id="start" name="start" required step="1" />
<input type="time" id="end"   name="end"   required step="1" />
<input type="time" id="pause" name="pause" step="1" value="00:00:00" />
```

---

## Nutzung

1. **App öffnen**, Mitarbeiter-ID eingeben, **Einloggen**.
2. **Check-in** → Arbeitszeit läuft; optional **Pause starten/beenden**.
3. **Check-out** → App sendet Daten (mit Sekunden) an `zeiterfassung`-Webhook.
4. Bei **mehreren Einträgen am selben Tag**: unterschiedliche Startzeiten → unterschiedliche `Erfassungs-ID` → mehrere Zeilen.
   Gleich identische Startzeit → **Update** derselben Zeile (frühester Start, spätester End).

---

## Geschäftslogik

* **Zeiten werden sekundengenau** übertragen (`HH:MM:SS`).
* **Mindestpausen** (Standard in `script.js`):

  * `> 6h` bis `≤ 9h`: mindestens **30:00**
  * `> 9h`: mindestens **45:00**
  * Falls weniger Pause gestempelt wurde, **füllt die App** auf diesen Wert auf (niemals reduziert).
  * (Bei Bedarf auf 9h-Grenze anpassen; siehe Kommentar im Code.)
* **Erfassungs-ID** = `YYYY-MM-DD_<Mitarbeiter-ID>_<Start-HHMMSS>`
  → garantiert Eindeutigkeit für mehrere Stiche pro Tag und ermöglicht Updates.

---

## API Endpoints (Beispiele)

* **Login-Check:** `POST https://<dein-n8n>/webhook/check-mitarbeiter`
* **Zeiterfassung:** `PUT https://<dein-n8n>/webhook/zeiterfassung`

### Test per cURL

**Login-Check:**

```bash
curl -X POST https://<dein-n8n>/webhook/check-mitarbeiter \
  -H "Content-Type: application/json" \
  -d '{"id":"0001"}'
```

**Zeiterfassung (PUT):**

```bash
curl -X PUT https://<dein-n8n>/webhook/zeiterfassung \
  -H "Content-Type: application/json" \
  -d '{
    "date":"2025-08-16",
    "start":"09:12:34",
    "end":"17:05:08",
    "pause":"00:30:00",
    "description":"Projektarbeit",
    "id":"0001",
    "vorname":"Max",
    "nachname":"Mustermann"
  }'
```

## Sicherheit

* App ist **statisch**; sensibler Teil ist n8n/Google Sheets.
* Schütze n8n (Auth, IP-Filter, HTTPS).
* Vermeide, die Webhook-URLs öffentlich zu streuen.
* Optional: Token im Request mitschicken und in n8n prüfen.

---

