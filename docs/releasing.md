# Desktop releases

Desktop releases are built from version tags by `.github/workflows/release.yml`. The workflow creates a draft GitHub release, builds every platform, verifies updater metadata against the generated artifacts, deploys the website, and only then publishes the release.

## Signing configuration

Automatic updates must only ship signed desktop applications. Configure these GitHub Actions secrets before creating a release tag:

| Secret | Purpose |
| --- | --- |
| `MACOS_CSC_LINK` | Base64 data or secure URL for the Developer ID Application certificate |
| `MACOS_CSC_KEY_PASSWORD` | Password for the macOS signing certificate |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect API private key used for notarization |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID |
| `WINDOWS_CSC_LINK` | Base64 data or secure URL for the Windows code-signing certificate |
| `WINDOWS_CSC_KEY_PASSWORD` | Password for the Windows signing certificate |

The release workflow stops before packaging when required credentials are missing. macOS builds are notarized automatically when the Apple API credentials are present.

## Update artifacts

`electron-builder` creates GitHub-provider metadata alongside installers. Each build job runs `npm run verify:update-artifacts` before uploading `latest*.yml`, installers, and blockmaps to the same GitHub release. Do not rename or remove artifacts referenced by those metadata files.

Installed macOS builds, Windows NSIS builds, and Linux AppImages update in place. Windows portable builds, Linux distribution packages, development builds, and mobile builds direct users to the download page instead.
