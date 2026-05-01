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
`ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables (these are the
*bootstrap* credentials — once you change the password from inside the panel,
the new bcrypt hash is stored in `server/data/db.json` and survives restarts).

A `SESSION_SECRET` is generated at startup if not set. For production, set a
fixed `SESSION_SECRET` so sessions survive restarts.

### Changing / resetting the admin password

- **Change while logged in:** Sidebar → **Account** → enter current + new password
  (min. 8 chars). New hash is persisted to `db.json`.
- **Forgot password (locked out):** Set a Replit Secret named
  `ADMIN_RESET_TOKEN` to any long random value, restart the app, then visit
  `/forgot-password`. Enter the username, the token, and your new password.
  After a successful reset, **rotate or delete `ADMIN_RESET_TOKEN`** so it can't
  be reused.

## Admin panel features (dashboard)

The dashboard is a **single-device control panel** (defaults to the most-recently-seen
device, with a picker shown when multiple devices are registered):

- **Topbar** shows live "Device Status: Online/Offline" and "Last seen: X min ago".
- **Three big action cards** that POST to `/admin/quick-command`:
  - Get Location (queues a `locate` command)
  - Lock Device (queues `lock`)
  - Play Alarm (queues `alarm`)
- **Last Known Location** card: Leaflet/OpenStreetMap map, `Live` badge if the
  fix is < 5 min old, lat/lng, "Open in Maps" button (Google Maps), and a
  client-side reverse-geocoded address (via Nominatim).
- **Device Information** grid: Device Name, Phone Number, Battery Level (with
  a colored battery bar), App Version, Last Seen, Status pill.
- **SIM Change Alerts** table: time, old SIM, new SIM (read from
  `alert.meta.oldSim` / `alert.meta.newSim`).
- **Recent Commands** table: command, status (Success / Delivered / Pending), time.
- **Recent Intruder Photos** thumbnail grid + `View All` link to per-device page.
- Sidebar quick-actions for Lock Device and Play Alarm submit POSTs and return
  to the dashboard with a success notice.
- Login / logout with bcrypt password and cookie sessions.

The legacy multi-device admin views (`/admin/devices`, `/admin/blocked`,
`/admin/reports`) are still available — `All Devices` link in the sidebar.

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

## Customer portal & Trusted Contacts (Family Circle)

The customer-facing portal lives under `/customer/*` (login by phone + password,
demo: `+919811000222` / `demo1234`).

- **Trusted Contacts** (`/customer/contacts`): owner can add up to 5 trusted
  contacts (name + phone + optional email). Each contact gets a unique tokenized
  public link `/trusted/:token` — no login required.
- **Public share page** (`/trusted/:token`): shows phone status, motion pill,
  battery + trend, last known location on a Leaflet map, intruder photos, and a
  **live activity feed** that polls `/trusted/:token/live` every 30 seconds.
- **Live status JSON** (`/trusted/:token/live`): synthesised in
  `db.computeLiveStatus(ownerPhone)` — derives motion (Haversine on the last
  two locations, >50 m / 10 min ⇒ "On the move"), battery trend (charging /
  discharging / stable from `batterySamples`), and a unified events feed
  combining locations, battery changes, and recent alerts.
- **Battery history**: each battery change is recorded in `db.batterySamples`
  via `addBatterySample(deviceId, level, charging)`; `touchDevice` now records
  a sample whenever the reported level changes.
- **Emergency notifications**: when the customer hits Emergency Mode, every
  trusted contact is notified (`db.notifyTrustedContacts`); opening the share
  link marks the notification viewed.

## Multi-network location tracking (GPS + WiFi + Cell)

`POST /api/locations` accepts any combination of:
- `latitude` + `longitude` (+ optional `accuracy`) → recorded as **GPS**
- `wifiAps: [{ bssid, level? }]` → server resolves against `NETWORK_REGISTRY.wifi`
  using a signal-weighted centroid → recorded as **WiFi** (~30–80 m accuracy)
- `cellTowers: [{ mcc, mnc, lac/tac, cid }]` → resolved against
  `NETWORK_REGISTRY.cell` → recorded as **Cell** (~300–600 m accuracy)

Source preference order is **GPS → WiFi → Cell** — so even when GPS is blocked,
the Android client can still pin an approximate location by sending the
surrounding access points / towers. Resolution is pure server-side
(`db.resolveLocationPayload`) so no per-client API keys are required; in
production swap `NETWORK_REGISTRY` for Mozilla Location Service or Google
Geolocation API.

Each location record stores `source` and `contributors` (the human-readable
network names). All three views render a coloured **source pill** next to the
location:
- 🟢 GPS (green) — accurate
- 🔵 WiFi (blue) — approximate, with the AP names
- 🟡 Cell (amber) — rough, with the tower names

The activity feed item also includes the source (e.g. _"Phone reported
location · CELL · ±520 m · via Airtel India Gate"_).

## Storage

JSON file at `server/data/db.json`, plus uploaded photos in `server/data/intruders/`.
No external database required; you can swap to MongoDB/Postgres by replacing `server/db.js`.

## Auto Mode Switching (Normal · Suspicious · Theft)

The `mode` field on every device is auto-managed by `db.evaluateMode(deviceId,
trigger?)`, called from `addAlert` and `addLocation`. Three modes:

| Mode | Ping interval | Trigger examples |
|------|---------------|-------------------|
| `normal`     | 60 s | default |
| `suspicious` | 30 s | airplane mode, > 500 m drift in < 2 min |
| `theft`      | 10 s | SIM change, intruder photo, emergency / SOS, 3+ wrong PINs |

Once a device is in `theft`, only a manual `setModeManual` (customer or admin)
can downgrade it. Every mode escalation:

1. records a `modeChanges` row (from / to / reason / source),
2. queues a fresh `locate` command for the Android client,
3. fires a `mode_change` alert (visible in admin / customer / trusted activity
   feeds),
4. notifies all trusted contacts when arming `theft`.

### API

- `GET  /api/devices/:id/commands` — now returns `{ commands, mode }`. The
  Android client uses `mode.pingIntervalSec` to self-tune its background loop.
- `POST /api/devices/:id/mode` — `{ mode, reason? }`. Used by the admin panel.
- `POST /customer/mode` — same, scoped to the logged-in customer.

### UI

- **Admin topbar** (`partials/topbar.ejs`) — coloured pill (`THEFT` red /
  `SUSPICIOUS` amber / `NORMAL` green) with the reason as the tooltip.
- **Customer dashboard** (`customer/dashboard.ejs`) — full Protection Mode
  card with the pill, "since X", reason, three switch buttons, and a
  collapsible "Recent mode changes" list.
- **Trusted share page** (`trusted/view.ejs`) — pill next to "Phone status";
  live JS updates it from `data.protection` on every 30 s poll.

Mode pill CSS lives in both `public/css/styles.css` (admin) and
`public/css/customer.css` (customer + trusted share inherit from styles.css).
