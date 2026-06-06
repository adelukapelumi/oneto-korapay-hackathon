# Production Release Secrets

Use this guide to configure the secrets required by the `Build Android Release APK` GitHub Actions workflow.

## Required GitHub Secrets

Add these in GitHub:

- `ONETO_UPLOAD_KEYSTORE_BASE64`
- `ONETO_UPLOAD_STORE_PASSWORD`
- `ONETO_UPLOAD_KEY_ALIAS`
- `ONETO_UPLOAD_KEY_PASSWORD`
- `API_SSL_PIN_PRIMARY`
- `API_SSL_PIN_BACKUP`

Optional:

- `API_SSL_PIN_EXTRA`

## Android Release Keystore

If you do not already have a release keystore, generate one locally.

Example command:

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore oneto-upload.keystore -alias oneto -keyalg RSA -keysize 2048 -validity 10000
```

This command will prompt you for the keystore password and key password.

## Base64 Encode the Keystore for GitHub Secrets

After generating the keystore, convert it to Base64 for the `ONETO_UPLOAD_KEYSTORE_BASE64` secret:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\oneto-upload.keystore"))
```

Copy the output and save it as the `ONETO_UPLOAD_KEYSTORE_BASE64` secret.

## SSL Pin Secrets

The production mobile config requires at least two SSL pin values:

- `API_SSL_PIN_PRIMARY`
- `API_SSL_PIN_BACKUP`

These should be valid certificate pin hashes for `https://api.getoneto.com`.

Important:

- Do not invent these values
- Do not reuse placeholder values
- Keep a backup pin ready so certificate rotation does not break the app

If you do not already have the pin hashes from your TLS or certificate management process, obtain them before running the production workflow.

## After Secrets Are Added

1. Push your latest branch to GitHub
2. Open `Actions`
3. Run `Build Android Release APK`
4. Download the `oneto-android-release-apk` artifact after the workflow completes
