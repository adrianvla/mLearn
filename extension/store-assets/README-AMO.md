# mLearn browser extension — source code for AMO review

This archive contains the complete source for the submitted add-on package
(mLearn — Language Learning Overlay, version 1.0.2).

Public repository: https://github.com/adrianvla/mLearn (extension lives in `extension/`).

## Requirements

- Node.js 18 or later, with npm (developed on Node 26)
- A POSIX shell environment for the build script (`rm`, `mkdir`, `cp`).
  macOS and Linux work out of the box; on Windows use WSL or Git Bash.

## Build steps

1. Install dependencies (versions pinned by `package-lock.json`):

   npm install

2. Run the extension build:

   npm run build:extension

   This performs:
   - `tsc -p extension/tsconfig.json --noEmit` (type check)
   - three `esbuild` bundles: `content-script.js` (IIFE), `background.js` (IIFE),
     `popup/popup.js` (ESM)
   - copies `manifest.json`, `popup/popup.html`, `popup/popup.css`, and `icons/*.png`

3. The built add-on is written to `extension/dist/`.

4. The submitted add-on zip contains the CONTENTS of `extension/dist/`
   (with `manifest.json` at the zip root, not nested in a folder).

## Notes for the reviewer

- The only tools used are TypeScript (`tsc`, type checking only) and esbuild
  (bundling). No minification flags are passed; esbuild's default output for
  `--bundle` without `--minify` preserves readable identifiers and structure.
- The `background` manifest key carries both `service_worker` (Chrome) and
  `scripts` (Firefox event page) for cross-browser support; both point at the
  same bundled `background.js`.
- Extension sources are fully self-contained in `extension/src/`; nothing is
  imported from the rest of the repository. Root `package.json` and
  `package-lock.json` are included only for dependency versions and the build
  script definition.
