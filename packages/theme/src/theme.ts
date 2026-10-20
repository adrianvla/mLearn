import type { ThemeDocument } from '@mlearn/contracts';
import quartz from '../../../resources/themes/quartz.json';
import darkQuartz from '../../../resources/themes/dark-quartz.json';

export const builtInThemes: readonly ThemeDocument[] = [quartz, darkQuartz];
export const initialTheme: ThemeDocument = quartz;

// Import boundary for whole documents saved before the reference-parity rewrite.
// ID alone is not authority: same-ID user palettes, radii and extensions remain
// custom. Resolve untouched old presentation, never rewrite learner preferences.
// Remove these fingerprints only after a native schema migration records
// built-in/custom identity and no supported profile needs whole-document import.
const retiredBuiltIns = [
  { id: 'mlearn.quartz', name: 'Quartz', radius: 12, replacement: quartz, colors: {
    background: '#F1F2F4', surface: '#FFFFFF', text: '#20232A', muted: '#555D6B',
    accent: '#2458A6', onAccent: '#FFFFFF', border: '#CFD4DC',
  } },
  // The first pushed rewrite checkpoint could also be saved as a whole document.
  { id: 'mlearn.quartz', name: 'Quartz', radius: 8, replacement: quartz, colors: {
    background: '#F5F5F5', surface: '#EEEEEE', text: '#1A1A1A', muted: '#626262',
    accent: '#C44700', onAccent: '#FFFFFF', border: '#BFBFBF',
  } },
  { id: 'mlearn.slate', name: 'Slate', radius: 12, replacement: darkQuartz, colors: {
    background: '#15191F', surface: '#20262E', text: '#EDF0F5', muted: '#BAC2CE',
    accent: '#99BEFF', onAccent: '#15243C', border: '#414B5A',
  } },
] as const;

export function resolveBuiltInTheme(document: ThemeDocument): ThemeDocument {
  const retired = retiredBuiltIns.find(preset =>
    document.id === preset.id && document.name === preset.name && document.radius === preset.radius
    && Object.keys(document.extensions).length === 0
    && (['background', 'surface', 'text', 'muted', 'accent', 'onAccent', 'border'] as const)
      .every(key => document.colors[key] === preset.colors[key]));
  return retired ? { ...document, id: retired.replacement.id, name: retired.replacement.name,
    colors: { ...retired.replacement.colors }, radius: retired.replacement.radius } : document;
}

/** Rendering-only projection. Rust is authoritative for accepting and storing theme documents. */
export function resolveTheme(saved: ThemeDocument) {
  const document = resolveBuiltInTheme(saved);
  const rgb = Number.parseInt(document.colors.surface.slice(1, 7), 16);
  const lightSurface = 0.2126 * (rgb >> 16) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255) >= 128;
  const textRole = (fontSize: number, lineHeight: number, fontWeight: '400' | '500' | '600' | '700' = '400') => ({
    fontFamily: 'Helvetica Neue',
    fontSize: fontSize * document.textScale,
    lineHeight: lineHeight * document.textScale,
    fontWeight,
  });
  return {
    colors: { ...document.colors },
    controls: {
      selected: lightSurface ? '#FFFFFFB8' : `${document.colors.text.slice(0, 7)}14`,
      surface: `${document.colors.text.slice(0, 7)}0D`,
      field: lightSurface ? '#FFFFFF80' : `${document.colors.text.slice(0, 7)}14`,
      hover: lightSurface ? '#FFFFFFE6' : `${document.colors.text.slice(0, 7)}20`,
    },
    shell: { navigation: document.colors.background, content: document.colors.surface,
      canvas: lightSurface ? '#F3F5F7' : '#000000' },
    surfaces: { glass: lightSurface ? '#FFFFFF80' : '#82828233' },
    feedback: { success: lightSurface ? '#2F7D20' : '#58C333' },
    media: {
      background: '#000000',
      text: '#E8E8E8',
      muted: '#A6A6A6',
      chrome: '#1C1C1CE6',
      panel: '#242424B8',
      border: '#505050',
      footer: '#FFFFFF08',
      badge: '#FFFFFF20',
    },
    typography: {
      heading: textRole(20, 30, '600'),
      shellTitle: textRole(20, 30, '700'),
      navigation: textRole(18, 27),
      section: textRole(18, 27, '600'),
      groupTitle: textRole(16, 24, '600'),
      body: textRole(16, 24),
      caption: textRole(14, 21),
      detail: textRole(12, 17),
      // Edited Inspector targets use serif CJK headwords while Latin remains UI
      // sans. Refer to installed system fonts; no font binary is redistributed.
      inspectionTitle: { ...textRole(32, 44), _web: { fontFamily: '"Helvetica Neue", "Hiragino Mincho ProN", serif' } },
      inspectionBody: textRole(20, 28),
      inspectionReading: textRole(18, 26),
      mediaTitle: textRole(13, 20),
      subtitle: textRole(26, 44),
      action: textRole(16, 24, '500'),
      compactAction: textRole(14, 20, '500'),
      mediaAction: textRole(13, 20),
      knowledgeAction: textRole(16, 22, '700'),
      badge: textRole(15, 20, '600'),
    },
    pills: {
      neutral: { text: '#D6D6DC', surface: '#303037', top: '#48484F' },
      positive: { text: '#00CC00', surface: '#003300', top: '#2D4C25' },
      negative: { text: '#FF4D75', surface: '#481024', top: '#693146' },
    },
    radius: document.radius,
    textScale: document.textScale,
    spacing: {
      tiny: 4 * document.spacingScale,
      small: 8 * document.spacingScale,
      compact: 12 * document.spacingScale,
      medium: 16 * document.spacingScale,
      comfortable: 20 * document.spacingScale,
      large: 24 * document.spacingScale,
      section: 32 * document.spacingScale,
    },
    scrim: '#00000066',
  };
}
export type ResolvedTheme = ReturnType<typeof resolveTheme>;

/** Immediate editor feedback, not a second settings authority. Native validation runs on every save. */
export function parseThemePreview(source: string): ThemeDocument {
  if (source.length > 24_000) throw new Error('Theme document is too large.');
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== 'object') throw new Error('Expected a theme document.');
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1 || typeof data.id !== 'string' || !data.id || typeof data.name !== 'string' || !data.name) throw new Error('Theme requires schemaVersion 1, id and name.');
  if (!data.colors || typeof data.colors !== 'object') throw new Error('Theme colors are missing.');
  const colors = data.colors as Record<string, unknown>;
  for (const key of ['background', 'surface', 'text', 'muted', 'accent', 'onAccent', 'border']) {
    if (typeof colors[key] !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(colors[key])) throw new Error(`Invalid color: ${key}`);
  }
  if (typeof data.radius !== 'number' || !Number.isInteger(data.radius) || data.radius < 0 || data.radius > 48 || typeof data.textScale !== 'number' || data.textScale < 0.8 || data.textScale > 2) throw new Error('Unsupported radius or text scale.');
  if (data.spacingScale === undefined) data.spacingScale = 1;
  if (typeof data.spacingScale !== 'number' || !Number.isFinite(data.spacingScale) || data.spacingScale < 0.75 || data.spacingScale > 1.5) throw new Error('Theme spacing scale must be between 0.75 and 1.5.');
  if (data.extensions === undefined) data.extensions = {};
  if (!data.extensions || typeof data.extensions !== 'object' || Array.isArray(data.extensions)) throw new Error('Theme extensions must be an object.');
  return data as unknown as ThemeDocument;
}
