# PhoneRakshak

Android-only anti-theft application + Node.js backend with a custom admin dashboard
matching the "Phonerakshak Admin Panel" design.

## Project structure

```
app/         Android (Kotlin) app — open in Android Studio to build & run on a phone
server/      Node.js backend + admin web dashboard — runs on Replit
  index.js   Express entry point (port 5000)
  db.js      JSON-file storage (server/data/db.json + server/data/intruders/)
  routes/
    api.js     Endpoints used by the Android app (/api/*)
    admin.js   Authenticated admin dashboard routes (/admin/*)
  views/     EJS templates for the dashboard, login, devices, blocked, reports
  public/    CSS (dark theme matching the supplied design) + static assets
```

## Running locally on Replit

The workflow `Start application` runs `node server/index.js` on port 5000.
Open the preview to reach the admin login page.

**Default admin credentials:** `admin` / `admin123`. Override via the
`ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables.

A `SESSION_SECRET` is generated at startup if not set. For production, set a
fixed `SESSION_SECRET` so sessions survive restarts.

## Admin panel features (dashboard)

- Stat cards: Total Users, Active Users, SOS Alerts, Blocked Numbers, Reports Filed.
- Overview Analytics line chart (cumulative users, daily SOS alerts, daily reports — 31 days).
- Top Blocked Numbers list (with `View All` page).
- Users by City donut chart.
- Recent Reports list (with `View All` page).
- Footer cards: Total Calls Monitored, Devices Registered, App Version.
- Per-device page: Live map (Leaflet/OpenStreetMap), remote command buttons
  (Lock, Alarm, Stop Alarm, Locate, Emergency, Unlock), alert history,
  command log, intruder photo gallery.
- Login / logout with bcrypt password and cookie sessions.

## API used by the Android app (no auth — keyed by `deviceId`)

- `POST /api/devices` — register/upsert a device.
- `POST /api/devices/:id/ping` — heartbeat (touches `lastSeen`).
- `POST /api/locations` — push a GPS fix.
- `POST /api/alerts` — push an alert (emergency, sim_change, wrong_pin, intruder_photo, blocked_call, call_monitored, etc.).
- `GET  /api/devices/:id/commands` — poll pending commands (server marks them delivered).
- `POST /api/devices/:id/commands/:cid/ack` — acknowledge a command result.
- `POST /api/intruders` — multipart upload an intruder photo (field `photo`, plus `deviceId`).
- `GET  /api/intruders/:filename` — fetch an uploaded photo.

## Building the Android APK

1. Open the project folder in Android Studio (File → Open → select this folder).
2. **Set the Gradle JDK**: Settings → Build, Execution, Deployment → Build Tools →
   Gradle → set "Gradle JDK" to the bundled JDK (jbr-17 / jbr-21 / Embedded).
3. Sync Gradle.
4. Set the backend URL on the device's Setup screen (e.g. your Replit URL).
5. **Build → Build Bundle(s) / APK(s) → Build APK(s)** for an unsigned debug APK,
   or **Build → Generate Signed Bundle / APK** for a release AAB/APK.

## Storage

JSON file at `server/data/db.json`, plus uploaded photos in `server/data/intruders/`.
No external database required; you can swap to MongoDB/Postgres by replacing `server/db.js`.
