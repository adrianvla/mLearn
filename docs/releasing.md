# Desktop releases

Desktop releases are built from version tags by `.github/workflows/release.yml`. The workflow creates a draft GitHub release, builds every platform, verifies updater metadata against the generated artifacts, deploys the website, and only then publishes the release.

## Signing status

macOS and Windows release artifacts are currently built without distribution certificates. macOS and Windows users can still download installers manually, but unsigned macOS builds never publish an in-place update feed because Squirrel.Mac rejects them. Windows artifacts are unsigned and can trigger operating-system trust warnings.

macOS in-place updates are not considered supported until the app uses a stable Developer ID Application identity and notarization. Windows NSIS and Linux AppImage updater paths can be exercised, but unsigned Windows builds may still trigger trust warnings.

When signing credentials become available, configure these GitHub Actions secrets. The release workflow automatically signs, notarizes, verifies, and publishes the macOS update feed when all five are present:

| Secret | Purpose |
| --- | --- |
| `MACOS_CSC_LINK` | Base64-encoded `.p12` export of your Developer ID Application certificate |
| `MACOS_CSC_KEY_PASSWORD` | Password you set when exporting the certificate |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect API `.p8` private key (used for notarization) |
| `APPLE_API_KEY_ID` | App Store Connect API key ID (e.g. `ABC123XYZ`) |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID (a UUID) |
| `WINDOWS_CSC_LINK` | Base64 data or secure URL for the Windows code-signing certificate |
| `WINDOWS_CSC_KEY_PASSWORD` | Password for the Windows signing certificate |

### One-time secret setup

After obtaining an Apple Developer account, follow these steps **once** — afterward the CI signs, notarizes, verifies, and publishes every `v*` tag automatically:

1. **Export your signing certificate.**
   Open Keychain Access → find your *Developer ID Application* certificate (team name) → right-click → Export. Save as `certificate.p12`. Choose a strong password and note it (you will use it for `MACOS_CSC_KEY_PASSWORD`).

2. **Create an App Store Connect API key.**
   - Go to <https://appstoreconnect.apple.com/access/api>
   - Click the **+** button → *Keys* → give it a name (e.g. `mLearn CI`)
   - Select *Developer* role, check *View* and *Upload* apps, *View reports*
   - Click *Generate*, then download the `AuthKey_XXXXXXXXXX.p8` file
   - Note the **Key ID** and **Issuer ID** displayed on the page

3. **Base64-encode both files** (from the repo root):

   ```bash
   ./scripts/encode-certs.sh ./path/to/certificate.p12 ./path/to/AuthKey_XXXXXXXXXX.p8
   ```

   The script prints the exact `gh secret set` commands — copy and paste them to add all secrets in one shot.

4. **Push a tag** — the release workflow runs automatically:

   ```bash
   npm version 2.8.5        # bumps package.json
   git push origin dev      # push the version commit
   git checkout main && git pull && git merge dev && git push
   git push origin v2.8.5   # triggers the release workflow
   ```

   The GitHub Actions workflow signs the app with your Developer ID certificate, submits it for notarization via the API key, staples the notarization ticket, verifies the signature chain with `codesign --verify` and `spctl`, uploads updater artifacts (`.zip`, `.blockmap`, `latest-mac.yml`) to the GitHub release, and finally publishes the release. End users with signed builds receive in-place Squirrel.Mac auto-updates; users with older unsigned builds are directed to the download page.

## Update artifacts

Signed macOS builds publish `latest-mac.yml`, zip, and blockmap assets only after strict code-signature verification. Unsigned macOS builds publish the DMG only. Each updater-enabled build job runs `npm run verify:update-artifacts` before uploading metadata, installers, and blockmaps to the same GitHub release. Do not rename or remove artifacts referenced by those metadata files.

Signed and notarized macOS builds, Windows NSIS builds, and Linux AppImages update in place. Windows portable builds, Linux distribution packages, development builds, and mobile builds direct users to the download page instead.
