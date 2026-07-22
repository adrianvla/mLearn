# Chrome Web Store — mLearn Extension Listing Kit

Everything needed to publish `mlearn-extension-v1.0.2.zip` (Manifest V3, built 2026-07-17 from commit `9c0f19c39`).

## Files

| Asset | File | Notes |
|---|---|---|
| Upload package | `mlearn-extension-v1.0.2.zip` | manifest at zip root, verified |
| Screenshot 1 | `cws-1-app.png` | mLearn desktop app (1280×800) |
| Screenshot 2 | `cws-2-popup.png` | Extension popup, connected state (1280×800) |
| Screenshot 3 | `cws-3-web-lookup.png` | Dictionary overlay on Japanese web page (1280×800) |
| Screenshot 4 | `cws-4-video-overlay.png` | Subtitle overlay + lookup on web video (1280×800) |
| Store icon | `../icons/icon-128.png` | 128×128, already in the zip |

## Listing copy

**Name**: `mLearn — Language Learning Overlay` (set in manifest, baked into the zip)

**Short description** (max 132 chars):
```
Learn Japanese while you watch. Interactive subtitle overlay with instant dictionary lookups on any streaming video site.
```

**Detailed description**:
```
mLearn turns the videos and web pages you already use into Japanese study material.

The mLearn Browser Extension connects your browser to the mLearn desktop app. It detects video players and subtitle tracks on any site — YouTube, Netflix, and generic HTML5 players — and syncs them with mLearn's interactive overlay in real time.

FEATURES
• Interactive subtitle overlay — watch with dual subtitles, furigana, and per-word color coding
• Instant dictionary — hover or tap any word for definitions, readings, and JLPT level
• One-click Anki export — send words and full sentence context to your Anki decks
• Word tracking — known/learning status follows you across videos and pages
• Playback control — skip ±5s, play/pause, and resync from the extension popup
• Works everywhere — YouTube, Netflix, and any HTML5 video or Japanese text on the web

HOW IT WORKS
1. Install the free mLearn desktop app from https://mlearn.kikan.net
2. Install this extension and open any video page
3. Click the mLearn icon — the popup shows the connection status and playback controls
4. Press "Open Overlay" to launch the interactive learning overlay

The extension communicates only with the mLearn app running on your own machine. No browsing data leaves your computer.

Open source: https://github.com/adrianvla/mLearn
```

## Console field values

- **Category**: Productivity
- **Language**: English
- **Official URL / Homepage**: https://mlearn.kikan.net
- **Support email**: support@kikan.net
- **Privacy policy URL**: https://mlearn.kikan.net/privacy
- **Visibility**: Public · **Pricing**: Free · **Regions**: All

## Single-purpose statement (review form)

> mLearn's single purpose is helping users learn languages from video and web content by connecting browser video players to the mLearn desktop app's interactive subtitle and dictionary overlay.

## Permission justifications (review form)

- **`activeTab`**: Detects the video element and subtitle tracks on the tab the user activates mLearn on, and sends playback commands (play/pause/seek) when the user clicks popup controls.
- **`storage`**: Stores the user's local preferences (connection state, subtitle and overlay settings) on their own device.
- **`alarms`**: Maintains the keepalive/sync schedule with the mLearn desktop app so subtitle timing stays accurate.
- **`windows`**: Opens and positions the mLearn overlay control window when the user clicks "Open Overlay" in the popup.
- **Host access (`<all_urls>`)**: mLearn is a site-agnostic learning tool. It must detect HTML5 video players and extract subtitle/caption tracks on any streaming or web page the user chooses to study with (YouTube, Netflix, and arbitrary sites). There is no fixed list of supported sites; limiting host access would break the core feature.
- **Remote code**: This extension does not execute remote code. All JavaScript is bundled in the package.

## Data usage certification (compliance tab)

- The extension itself **does not collect or transmit user data** to any server. It communicates exclusively with the mLearn desktop app on `127.0.0.1` and, only if the user explicitly signs in to optional mLearn Cloud sync in the desktop app, with `mlearn.kikan.net` (email for account auth — covered by the privacy policy).
- Certify: no sale of data, no use for unrelated purposes, no credit/lending use.

## Submission steps

1. https://chrome.google.com/webstore/devconsole → sign in (one-time $5 developer fee if the account is new)
2. **New Item** → upload `mlearn-extension-v1.0.2.zip`
3. **Store listing** tab: paste description, set category/language, upload icon (auto-read from zip) + the 4 screenshots
4. **Privacy practices** tab: paste single-purpose statement + permission justifications, set privacy policy URL, fill data usage certification
5. **Distribution** tab: Public, all regions
6. **Submit for review** — typical review: 1–3 days (broad host permissions can push it to ~1 week)

## Post-publish

- Add the CWS link to the website footer social links + `InstallDropdown.tsx` (Chrome Web Store entry is already stubbed there, commented out)
- Update `llms.txt` "Install" section with the CWS URL
- Enables Chrome auto-updates for extension users
