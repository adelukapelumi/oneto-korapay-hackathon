# APK Submission Checklist

This checklist is the fastest path to a valid mobile submission for the hackathon.

## Recommended Strategy

Use the APK as the primary judging artifact, and prefer GitHub Actions over the local machine if local Android builds are slow or unstable.

Reason:
- The submission form explicitly supports APK upload for mobile apps.
- Your live link is optional.
- This reduces the risk of judges landing on a partial admin surface instead of the main product experience.

## Before Building

1. Confirm `mobile/.env` contains a valid backend URL:

```env
EXPO_PUBLIC_API_URL=https://api.getoneto.com
```

2. Make sure dependencies are installed:

```powershell
pnpm install
```

3. Decide build path:
- Preferred: GitHub Actions release APK build
- Backup: EAS build
- Fallback: local Android release APK from the checked-in `mobile/android` project

## Option A: Build with GitHub Actions

This repo now includes a manual workflow:

- Workflow name: `Build Android Release APK`
- Artifact name: `oneto-android-release-apk`

How to use it:

1. Push your current branch to GitHub.
2. Open the repository on GitHub.
3. Go to `Actions`.
4. Open `Build Android Release APK`.
5. Click `Run workflow`.
6. Wait for the workflow to finish.
7. Download the `oneto-android-release-apk` artifact from the run summary.

Why this is the best path:

- It avoids local Gradle and Android SDK instability
- It uses the repo's checked-in Android project
- It already targets `https://api.getoneto.com`

## Option B: Build with EAS

From the repo root:

```powershell
cd C:\Users\LENOVO\Documents\oneto\mobile
npx eas-cli build --platform android --profile preview
```

Notes:
- `preview` is a good fit here because it is configured for internal distribution.
- You will likely need to log in to Expo/EAS in the terminal.
- When the build completes, EAS will give you a download link for the APK or installable artifact.

## Option C: Build a Local Release APK

From the repo root:

```powershell
cd C:\Users\LENOVO\Documents\oneto\mobile\android
.\gradlew.bat assembleRelease
```

Expected output location:

```text
mobile\android\app\build\outputs\apk\release\
```

Notes:
- This release build is currently configured to use the debug signing config in `mobile/android/app/build.gradle`.
- That is acceptable for hackathon APK sharing, but not for Play Store production release.
- Local Android builds require a working Android SDK and Java setup on your machine.

## What to Upload

- Upload the generated APK file in the `Upload Test File / APK` field.
- If the form asks for SDK/supporting asset upload and you do not have a special SDK file, use a short PDF or ZIP that contains:
  - project summary
  - architecture screenshot(s)
  - key screens
  - integration notes for Korapay

## Prototype Video Recommendation

Keep the video between 2 and 4 minutes and show:

1. The problem: internet dependency at point of payment
2. Student creates offline payment
3. Merchant scans QR
4. Payment is stored offline
5. Reconciliation when internet returns
6. Korapay-backed top-up or cashout flow
7. Why this helps financial inclusion and payment reliability

## Submission Advice

- If `https://admin.getoneto.com` is not polished for judges, do not rely on it as the main demo.
- A clean APK + short prototype/demo video is likely the strongest submission path for this project.
