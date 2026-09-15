# Katu Maps Android TWA

This directory contains the Bubblewrap-generated Android project for the Katu
Maps Trusted Web Activity (TWA). It intentionally lives in the main Katu Maps
repository, rather than a separate `Katu-Maps-Android` repository, because the
wrapper is small and tightly coupled to the production web manifest. Keeping
both together makes manifest, icon, scope, and wrapper changes atomic and
reviewable.

## Fixed application configuration

- Application ID: `io.github.karriz.katumaps`
- App and launcher name: `Katu Maps`
- Production start URL and scope: `https://karriz.github.io/Katu-Maps/`
- Web manifest: `https://karriz.github.io/Katu-Maps/manifest.webmanifest`
- Theme color: `#17344B`
- Background/splash color: `#74C8F4`
- Launcher icon: `https://karriz.github.io/Katu-Maps/icon-512.png`
- Maskable icon: `https://karriz.github.io/Katu-Maps/icon-maskable-512.png`
- Compile and target SDK: Android 16 / API 36

The project was initialized with Bubblewrap CLI `1.25.0`. API 36 is required
for new apps and updates submitted to Google Play from 31 August 2026. Keep
`compileSdkVersion` and `targetSdkVersion` at 36 or newer when updating.

## Toolchain and clean-checkout build

Install Node.js, then run Bubblewrap without a global install by pinning the
known generator version. On first use, allow Bubblewrap to provision its JDK 17
and Android SDK, or point it at compatible existing installations.

```sh
cd android
npx --yes --package @bubblewrap/cli@1.25.0 bubblewrap build \
  --skipSigning
```

That command is the clean-checkout verification build and requires no signing
secret. It produces an unsigned release bundle under
`app/build/outputs/bundle/release/`. Generated build outputs, SDK paths, and
signing files are ignored.

To refresh the wrapper after deploying a changed production web manifest:

```sh
cd android
npx --yes --package @bubblewrap/cli@1.25.0 bubblewrap update \
  --manifest=https://karriz.github.io/Katu-Maps/manifest.webmanifest
```

Review `twa-manifest.json` and `app/build.gradle` after every update. In
particular, confirm the application ID, start URL, manifest URL, colors, icons,
and API level listed above. Increment `appVersionCode` for every Play upload.

## Upload key and signed Play bundle

Generate the upload key outside the checkout. This example uses Bubblewrap's
private configuration directory; use a password manager to generate and store
distinct high-entropy passwords.

```sh
mkdir -p "$HOME/.bubblewrap"
chmod 700 "$HOME/.bubblewrap"
keytool -genkeypair \
  -storetype JKS \
  -keystore "$HOME/.bubblewrap/katu-maps-upload.keystore" \
  -alias katu-maps-upload \
  -keyalg RSA -keysize 4096 -validity 10000
chmod 600 "$HOME/.bubblewrap/katu-maps-upload.keystore"
```

Set passwords only in the current shell (or let Bubblewrap prompt), then build:

```sh
cd android
read -rsp 'Keystore password: ' BUBBLEWRAP_KEYSTORE_PASSWORD; echo
read -rsp 'Key password: ' BUBBLEWRAP_KEY_PASSWORD; echo
export BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD
npx --yes --package @bubblewrap/cli@1.25.0 bubblewrap build \
  --signingKeyPath="$HOME/.bubblewrap/katu-maps-upload.keystore" \
  --signingKeyAlias=katu-maps-upload
unset BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD
```

The Play Console upload artifact is `android/app-release-bundle.aab`. It is
ignored because release binaries should be retained in private release storage,
not Git.

### Private backup and recovery

Back up all of the following together in two independent private locations
(for example, an encrypted password-manager attachment and encrypted offline
media): the upload keystore, its alias, both passwords, and the SHA-256
certificate fingerprint. Restrict access to release maintainers and test a
restore by listing the copied key with `keytool -list -v`. Never commit, attach
to an issue, paste into CI logs, or send any of these values through chat.

Record whether Play App Signing is enabled. With Play App Signing, Google holds
the distribution signing key and this local key is the upload key; if the upload
key is lost, follow Play Console's upload-key reset process. The private backup
is still required for routine releases and disaster recovery.

## Digital Asset Links (required for full-screen TWA verification)

The website must serve a valid file at the origin root:

`https://karriz.github.io/.well-known/assetlinks.json`

It must delegate `delegate_permission/common.handle_all_urls` to
`io.github.karriz.katumaps` and contain the **Play app-signing certificate**
SHA-256 fingerprint shown in Play Console under App integrity. The Play signing
fingerprint is normally different from the local upload-key fingerprint. A
locally installed APK can additionally be tested by listing the upload-key
fingerprint in the file.

Because Katu Maps is hosted as the `/Katu-Maps/` GitHub Pages project site, this
origin-root file must be deployed by the repository that owns the
`karriz.github.io` user site (or by changing to a domain whose root is under
this project's control). Without that origin-root association, the application
still opens the correct production URL but the browser falls back to a Custom
Tab with browser UI instead of a verified TWA.

After publishing the association, verify it directly and with Google's Digital
Asset Links API before releasing. Test both a locally signed build and the Play
Store build because they use different certificates.
