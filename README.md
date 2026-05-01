# PhoneRakshak

Android-only anti-theft application + a Node.js backend with a mobile-friendly
admin dashboard. Designed as a stable Android MVP that can be tested on real
devices.

## What's in this repo

```
app/      Android (Kotlin) app — open in Android Studio to build & run on a phone
server/   Node.js backend + admin web dashboard — runs on Replit (or anywhere)
```

## Features

### Android app (com.example.phonerakshak)
- **Setup wizard** — phone number, emergency contact, PIN, optional backend URL.
- **In-app Dashboard** — protection status, device-admin status, backend
  status, last known location, quick actions.
- **Emergency Mode** — big panic button that sounds the alarm, SMSes the
  emergency contact with a Maps link, and pushes an alert to the backend.
- **Lock screen** — full-screen lock activity with a custom message; only the
  PIN unlocks it. Falls back to `DevicePolicyManager.lockNow()` when Device
  Admin is enabled.
- **Intruder photo capture** — silent front-camera photos after wrong PIN
  attempts; viewable in a grid in the app and uploaded to the backend.
- **SIM/network change detection** — sends an SMS + backend alert with the
  current location to the emergency contact when a different SIM is inserted.
- **GPS + Maps integration** — tap "Update Location" to push a fix; tap "Open
  in Maps" to launch the Maps app on the last known fix.
- **SMS commands** (replace `<PIN>` with your PIN, send from any other phone):
  - `LOCK<PIN>` — lock the screen.
  - `LOC<PIN>` — reply with a Google Maps link to the current location.
  - `ALARM<PIN>` — sound the alarm at full volume for 60 seconds.
  - `STOPALARM<PIN>` — stop the alarm.
  - `SOS<PIN>` — trigger Emergency Mode.
- **Remote commands via backend** — the foreground service polls the backend
  every ~30 seconds and executes queued commands (`lock`, `unlock`, `alarm`,
  `stop_alarm`, `locate`, `emergency`).
- **Foreground service** that survives reboots and aggressive OEM battery
  managers, with notifications.

### Backend & admin dashboard (Node.js + Express)
- **Admin login / logout** with cookie sessions and bcrypt-hashed passwords.
- **Mobile-friendly responsive dashboard** (no app needed — works on a phone
  browser) listing all registered devices with online/offline status.
- **Per-device detail page** with:
  - Live map (Leaflet + OpenStreetMap, no API key needed) showing the latest
    fix and a polyline of recent locations.
  - Remote command buttons: Lock, Alarm, Stop Alarm, Update Location,
    Emergency Mode.
  - Alert history (sim_change, emergency, wrong_pin, intruder_photo, etc.).
  - Intruder photo gallery.
  - Command log (pending → delivered → done).
- **Storage**: simple JSON file at `server/data/db.json` plus uploaded photos
  in `server/data/intruders/`. No external database required.

## Running the backend on Replit

The workflow `Start application` runs `node server/index.js` on port 5000.
Open the preview to reach the admin login page.

**Default admin credentials:** `admin` / `admin123`. Change them via the
`ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables (Secrets pane).

A `SESSION_SECRET` is generated at startup if not set. For production, set a
fixed `SESSION_SECRET` so sessions survive restarts.

## Building the Android app

1. Open the project folder in Android Studio (File → Open → select this
   folder, **not** its parent).
2. Let Gradle sync.
3. **Set the backend URL** in either of two ways:
   - **Recommended (runtime):** install the app, open the Setup screen, paste
     your Replit URL (e.g. `https://your-app.replit.app`) into "Backend URL",
     and tap Save.
   - **Build-time (optional):** add `backendUrl=https://your-server.example.com`
     to project-level `gradle.properties`.
4. Build & run on a real device — most features (SMS receivers, Device Admin,
   foreground service, front-camera intruder photo) don't fully work in the
   emulator.

## First-run setup on the phone

1. Launch the app, grant the requested permissions (SMS, location, camera,
   phone state, notifications, overlay).
2. In the Setup screen, enter:
   - Your phone number (optional)
   - Emergency contact phone number (required)
   - PIN of 4–8 digits
   - Backend URL (optional, e.g. your Replit URL)
3. Tap **Enable Device Admin** and approve — required for `LOCK` to put the OS
   into its lock screen.
4. Tap **Save and start protection**. The foreground service starts, the
   current SIM is recorded as the trusted baseline, and the device registers
   with the backend (if configured).
5. The app moves to the Dashboard, where you can test the alarm/lock and
   trigger Emergency Mode.

## Architecture notes

- **No external services required.** Maps use OpenStreetMap; storage is a JSON
  file; no Firebase/MongoDB needed for the MVP. The data layer is isolated in
  `server/db.js` so you can swap in MongoDB or Firebase later without touching
  the API surface.
- **Best-effort, never-crash** style: every backend call from the Android app
  is wrapped in try/catch and logs failures rather than crashing.
- **Two control channels**: SMS (no internet needed) and the backend command
  queue (works over WiFi/data). Either alone is enough.

## Package ID

`com.example.phonerakshak`
