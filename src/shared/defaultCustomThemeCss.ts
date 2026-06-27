/**
 * Default CSS for the "Custom" theme.
 *
 * This is a copy of the dark theme (src/renderer/styles/themes/dark.css) with
 * every `theme-dark` selector replaced by `theme-custom` so the rules activate
 * when `<body>` carries the `theme-custom` class. It serves as a starter that
 * the user can edit freely from the Settings UI.
 */
export const DEFAULT_CUSTOM_THEME_CSS = `/* Custom theme — edit freely. Starter: copy of the dark theme. */

/* === WordHover === */
.subtitle_hover.theme-custom,
body.theme-custom .subtitle_hover {
    background-color: rgba(60,60,60, 0.5);
    color: var(--text-primary);
    -webkit-text-stroke: 1px var(--bg);
}
body.theme-custom .subtitle_hover .pitch,
.subtitle_hover.theme-custom .pitch {
    filter: invert(1);
}

body.theme-custom .subtitle_hover .footer,
.subtitle_hover.theme-custom .footer {
    border-top: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.1);
}

body.theme-custom .subtitle_hover hr,
.subtitle_hover.theme-custom hr {
    border-top-color: var(--border-color);
}

body.theme-custom .subtitle_hover_alt_c,
.subtitle_hover.theme-custom .subtitle_hover_alt_c {
    background: rgba(0, 0, 0, 0.5);
}

/* === CSS variables === */
body.theme-custom {
    --bg-opaque: #000;
    --bg-nt-primary: rgb(26,26,26);
    --bg-nt-secondary: rgb(38,38,38);
    --kanji-grid-unknown-bg: #616161;
    --text-primary: #f0f0f0;
    --text-secondary: #a0a0a0;
    --text-tertiary: rgba(255, 255, 255, 0.4);

    --bg: rgba(130, 130, 130, 0.2);
    --bg-intense: rgba(255, 255, 255, 0.15);
    --border-color: rgba(255, 255, 255, 0.15);
    --border-color-intense: rgba(255, 255, 255, 0.25);

    --backdrop-filter: blur(20px) saturate(2) brightness(0.8);
    --backdrop-filter-nodim: blur(20px) saturate(2);

    --flashcard-highlight: #ff5ec7;

    --panel-bg: rgba(60,60,60, 0.5);
    --panel-bg-hover: var(--bg-intense);
    --panel-border: var(--border-color);
    --panel-border-hover: var(--border-color-intense);
    --bg-primary: var(--bg);
    --bg-secondary: var(--bg-intense);
    --shadow-border: var(--border-color) 0px 0px 0px 1px;

    --overlay-bg: rgba(0, 0, 0, 0.6);
    --overlay-bg-soft: rgba(0, 0, 0, 0.4);
}

/* === PitchAccent === */
body.theme-custom .pitch-accent-container,
.theme-custom .pitch-accent-container {
    color: var(--text-primary);
}

.subtitle_hover .pitch-accent {
    --pitch-accent-height: 2px;
}

.subtitle_hover .pill.pitch-accent-pill .pitch-accent {
    --pitch-accent-height: 2px;
}

.subtitle_hover .pill.pitch-accent-pill .pitch-accent-word {
    position: relative;
}

body.theme-custom .subtitle_hover .pitch-accent,
.subtitle_hover.theme-custom .pitch-accent {
    filter: none;
    color: var(--text-primary);
}

/* === Pill === */
body.theme-custom .label-pill,
body.theme-custom .btn-pill,
body.theme-custom .label-status {
    filter: invert(1) hue-rotate(180deg) saturate(200%);
    box-shadow: rgba(50, 50, 93, 0.1) 0px 30px 60px -12px inset,
    rgba(0, 0, 0, 0.3) 0px 18px 36px -18px inset;
}

body.theme-custom .label-pill .label-icon img,
body.theme-custom .btn-pill .btn-icon-wrapper img,
body.theme-custom .label-pill .label-icon svg,
body.theme-custom .btn-pill .btn-icon-wrapper svg,
body.theme-custom .label-pill .label-svg-icon,
body.theme-custom .btn-pill .btn-svg-icon,
body.theme-custom .label-status .label-icon img,
body.theme-custom .label-status .label-icon svg,
body.theme-custom .label-status .label-svg-icon {
    filter: invert(1) hue-rotate(180deg);
    background: transparent;
}

/* === ProgressBar === */
body.theme-custom .progress-bar-track {
    background: rgba(255, 255, 255, 0.1);
}
`;
