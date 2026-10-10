# UBC Finance — Android APK (GitHub)

1. Create a new GitHub repository and upload EVERYTHING in this folder (keep the `.github` and `android` folders).
2. Open the repo > Actions > "Build UBCOT APK" > Run workflow.
3. When it finishes, open the run and download the `UBCOT-apk` artifact (unzip it to get app-debug.apk).
4. Install on the phone (allow "install unknown apps").

Updating later: change the web files, raise `versionCode` (and `versionName`) in android/app/build.gradle,
push, and run the workflow again. The APK is always signed with android/app/ubcot.keystore, so the new APK
installs OVER the old app and keeps its data. Do not delete or replace that keystore.

Notes: package id is com.ubcot.app (separate from SSSACAD). The service worker (sw.js) is left out of the APK on
purpose. The app's data lives in the app's own storage: back up in the web version and restore inside the app
to move records across.
