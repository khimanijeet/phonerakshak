# Open this project in Android Studio

1. Extract the zip (if you got this as a zip).
2. Android Studio → **File → Open…**.
3. Select **this folder** (the one containing `settings.gradle`, `app/`,
   `gradle/`). Do **not** open a parent folder.
4. Wait for the Gradle sync to finish. The first sync downloads
   the Android Gradle Plugin, Kotlin, and dependencies — give it a few
   minutes the first time.

## If Gradle sync fails

| Problem | Fix |
| --- | --- |
| `SDK location not found` | File → Project Structure → SDK Location → pick your Android SDK folder. Android Studio writes it into `local.properties` for you. |
| `JAVA_HOME` errors / wrong JDK | File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK → pick the **embedded JDK 17** that ships with Android Studio. |
| Long download on first sync | Normal. Let it finish. |
| Network failures behind a proxy | File → Settings → HTTP Proxy → configure, then File → Sync Project with Gradle Files. |

## Run on a real device (recommended)

Most of this app's features (SMS receivers, Device Admin, foreground service
on aggressive OEMs, the front-camera intruder photo) don't fully work in the
emulator. Plug in a phone with USB debugging enabled and run from Android
Studio's green Run button.

## Optional backend URL

If you have a Node.js/Express server with `POST /api/devices` and
`POST /api/locations`, set the URL in the project-level `gradle.properties`:

```
backendUrl=https://your-server.example.com
```

Then re-sync and rebuild. Without this, the app runs in SMS-only mode and
all server calls are skipped.
