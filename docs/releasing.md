# Desktop releases

Desktop releases are built from version tags by `.github/workflows/release.yml`. The workflow creates a draft GitHub release, builds every platform, verifies updater metadata against the generated artifacts, deploys the website, and only then publishes the release.

## Signing status

macOS and Windows release artifacts are currently built without distribution certificates. macOS uses electron-builder's ad-hoc signature and is not notarized; Windows artifacts are unsigned. This keeps release packaging and updater metadata available, but users can encounter operating-system trust warnings.

macOS in-place updates are not considered supported until the app uses a stable Developer ID Application identity and notarization. Windows NSIS and Linux AppImage updater paths can be exercised, but unsigned Windows builds may still trigger trust warnings.

When paid signing credentials become available, configure these GitHub Actions secrets and restore the required signing checks in the release workflow:

| Secret | Purpose |
| --- | --- |
| `MACOS_CSC_LINK` | Base64 data or secure URL for the Developer ID Application certificate |
| `MACOS_CSC_KEY_PASSWORD` | Password for the macOS signing certificate |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect API private key used for notarization |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID |
| `WINDOWS_CSC_LINK` | Base64 data or secure URL for the Windows code-signing certificate |
| `WINDOWS_CSC_KEY_PASSWORD` | Password for the Windows signing certificate |

## Update artifacts

`electron-builder` creates GitHub-provider metadata alongside installers. Each build job runs `npm run verify:update-artifacts` before uploading `latest*.yml`, installers, and blockmaps to the same GitHub release. Do not rename or remove artifacts referenced by those metadata files.

Signed and notarized macOS builds, Windows NSIS builds, and Linux AppImages update in place. Windows portable builds, Linux distribution packages, development builds, and mobile builds direct users to the download page instead.
