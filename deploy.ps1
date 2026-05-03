$ErrorActionPreference = "Stop"

Write-Host "Setting JAVA_HOME..."
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"

Write-Host "Building Android APK..."
.\gradlew assembleDebug

Write-Host "Copying APK to server public download directory..."
Copy-Item "app\build\outputs\apk\debug\app-debug.apk" -Destination "server\public\download\PhoneRakshak.apk" -Force

Write-Host "Committing and pushing to GitHub/Render..."
git add .
git commit -m "Auto-deploy: Update APK and code changes"
git push

Write-Host "Deployment complete! Render will now pull the latest changes and serve the new APK."
