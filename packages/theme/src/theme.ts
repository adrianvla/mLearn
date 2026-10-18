import type { ThemeDocument } from '@mlearn/contracts';
import quartz from '../../../resources/themes/quartz.json';
import slate from '../../../resources/themes/slate.json';

export const builtInThemes: readonly ThemeDocument[] = [quartz, slate];
export const initialTheme: ThemeDocument = quartz;

/** Rendering-only projection. Rust is authoritative for accepting and storing theme documents. */
export function resolveTheme(document: ThemeDocument) {
  return {
    colors: { ...document.colors },
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
      family: 'Helvetica Neue',
      inspectionTitle: 32,
      inspectionBody: 20,
      inspectionReading: 18,
    },
    pills: {
      neutral: { text: '#D6D6DC', surface: '#303037', top: '#48484F' },
      positive: { text: '#38E34D', surface: '#063309', top: '#1E4F25' },
      negative: { text: '#FF4D75', surface: '#481024', top: '#693146' },
    },
    radius: document.radius,
    textScale: document.textScale,
    spacing: { small: 8, medium: 16, large: 24 },
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
  if (data.extensions === undefined) data.extensions = {};
  if (!data.extensions || typeof data.extensions !== 'object' || Array.isArray(data.extensions)) throw new Error('Theme extensions must be an object.');
  return data as unknown as ThemeDocument;
}
