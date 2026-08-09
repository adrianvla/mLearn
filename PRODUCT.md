# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(SolidJS design language rendered inside Electron desktop windows, Capacitor mobile WebViews, and the Flashcards PWA. The wrappers are native; the design language is web.)

## Users

- **Self-directed immersion learners** — primary. They learn by watching native video and reading manga/books/web content, and live inside the app daily.
- **Japanese-first learners** — the app's heritage audience; surfaces carry JLPT-style levels, kanji grid, furigana, pitch accent. The product is now language-agnostic, but this cohort's expectations shaped it.
- **Anki migrants / SRS power users** — want lookup + SRS integrated; mLearn replaces their Anki + dictionary-overlay + tracker stack. Muscle-memory-heavy, speed-critical users.
- **Not a primary audience:** classrooms/schools (a deployment guide exists, but the user confirmed they are not the design center).
- **Language breadth is real, not aspirational:** the published catalog is much larger than the README FAQ's "Japanese and German" suggests — it includes even Church Slavonic. Future work must never read as Japanese-only.

## Product Purpose

mLearn is an all-in-one language-learning immersion app that **knows what you know**. It passively tracks every word the user encounters across video, reader, web, and flashcards, building a per-word knowledge model — and every surface (subtitle color-coding, flashcard suggestions, SRS queue, AI tutor level) is driven by that model.

Success means:
- **Learning efficiency** — measurably faster vocabulary acquisition than any other method.
- **Daily immersion habit** — people immerse every day because the app feels good to live in.
- **Growth** — more learners, more published languages.

## Positioning

Two claims a neighboring product (Language Reactor, Yomitan, Anki, Migaku) cannot truthfully copy:

1. **The knowledge model** — one per-word knowledge state shared across *every* surface: video subtitles, OCR reader, web overlay, flashcards, AI tutor, statistics. Competitors have fragments; none have the unified model.
2. **Local-first privacy** — dictionaries, OCR, TTS, STT, and the LLM tutor all run on-device; the app works offline after language-data install. No learning data leaves the machine by default; cloud is opt-in.

## Operating Context

- **Desktop-first** (macOS Apple Silicon/Intel, Windows, Linux), 15 Electron windows: Main, Welcome, Video, Reader, Flashcards, Conversation Agent, Statistics, Settings, Kanji Grid, Word Definition, Word DB Editor, Word Sync, Connect QR, Plugin Host, Licenses, Overlay.
- **Usage scenes:** watching video with the interactive subtitle overlay (incl. always-on-top overlay over *any* player or streaming site via the Chrome/Firefox extension); reading manga/PDFs with real-time OCR and click-to-lookup; SRS review sessions with TTS and pitch/reading display; AI tutor voice conversation; word-knowledge assessment (Word Sync).
- **On the go:** Flashcards PWA (mlearn-app.kikan.net) syncs via cloud or tethered mode; native iOS/Android apps are in development via Capacitor.
- **Social:** Watch Together rooms; Discord community.
- **Language data** installs at runtime from a catalog (default mlearn.kikan.net/language-catalog.json; user-replaceable). Works offline after install.

## Capabilities and Constraints

- Core modes: Video Immersion, Reader/OCR (RapidOCR, PaddleOCR, MangaOCR), AI Conversation Agent (local Qwen3-4B, Ollama, or cloud), SRS Flashcards (5 tabs), Word Passive Tracking, Word Sync assessment, Statistics dashboard, Kanji Grid, Watch Together, browser extension, video/text overlays, plugin system.
- AI/Voice: Kokoro + Qwen3-TTS + system TTS with voice cloning; Whisper STT with VAD; LLM word explainer; bulk generation of sentences/audio.
- **Language-agnostic by hard rule:** all language behavior is metadata-driven from installed language packages; no language-specific branches in app code.
- **Local NLP backend:** Python FastAPI on port 7752; tethered web server on 7753 for mobile/browser.
- **Free and source-available** under the Sustainable Use License v1.0 — not open-source, not commercial. No pricing, paywalls, or monetization UX exists or should be invented.
- **Undecided/unknown:** native mobile app ship dates; school-deployment ambitions.

## Brand Commitments

- Name: **mLearn**; domains mlearn.kikan.net, mlearn-app.kikan.net, mlearn-cloud.kikan.net; support@kikan.net; Discord community.
- **Free for learners, forever** — Sustainable Use License; the "why source-available" stance (protect thousands of hours of work from resale while staying free) is part of the brand voice.
- **7-theme system**: Light, Dark, Darker, Light High Contrast, Dark High Contrast, Glass Light, Glass Dark. All colors are CSS-owned; no hardcoded colors in TSX.
- **Motion policy (user-pinned, binding):** almost no animations, no transitions. The app is built for muscle-memory-heavy power users; it must feel *really polished* through precision and detail, never through motion.
- Icons: SVG only (blendicons.com); no emojis in UI.
- No AI-aesthetic styling (no purple gradients etc.).

## Evidence on Hand

- Real product screenshots hosted at mlearn.kikan.net/img/* (overview, video player, reader/OCR, AI tutor, flashcards, kanji grid, word tracking, watch together, overlays) — referenced from README.
- Chrome Web Store listing kit: extension/store-assets/ (4 screenshots + copy).
- Product copy: README.md, extension store listing, FAQ.
- Legal/institutional: EULA.md, TERMS_OF_SERVICE.md, PRIVACY_POLICY.md, SCHOOL_DEPLOYMENT.md, LICENSE (Sustainable Use License v1.0).
- **Absent — do not fabricate:** testimonials, reviews, user counts, benchmarks, case studies, press, pricing.

## Product Principles

1. **The knowledge model is the product.** Every surface must visibly reflect what the user knows; a feature that ignores per-word knowledge state is off-strategy.
2. **Local-first, offline-capable.** On-device processing and privacy are positioning, not plumbing; cloud is always opt-in.
3. **Speed over spectacle.** No animations or transitions; polish lives in precision, alignment, and instant response for muscle-memory users.
4. **Language-agnostic always.** Any language may be in the catalog (even Church Slavonic); design and copy must never assume Japanese-only.
5. **Free for learners.** No monetization pressure shapes UX; honesty and transparency are the voice.

## Accessibility & Inclusion

- High-contrast themes (Light & Dark) ship as first-class themes.
- The no-motion policy serves vestibular-sensitive users as a side effect (its stated reason is power-user speed).
- UI is localized in multiple languages (locales in src/root-of-app/locales/).
