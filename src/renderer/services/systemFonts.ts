export interface InstalledSystemFont {
  family: string;
}

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

export const COMMON_SYSTEM_FONTS: string[] = [
  'Georgia',
  'Times New Roman',
  'Arial',
  'Helvetica Neue',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Courier New',
  'Consolas',
  'Monaco',
  'Menlo',
  'Segoe UI',
  'Roboto',
  'Ubuntu',
  'DejaVu Sans',
  'Liberation Serif',
  'Hiragino Mincho ProN',
  'Hiragino Kaku Gothic ProN',
  'Yu Mincho',
  'Yu Gothic',
  'Meiryo',
  'Noto Serif CJK JP',
  'Noto Sans CJK JP',
  'Noto Serif CJK SC',
  'Noto Sans CJK SC',
  'Songti SC',
  'SimSun',
  'SimHei',
  'Microsoft YaHei',
  'Malgun Gothic',
  'Apple SD Gothic Neo',
  'PingFang SC',
  'PingFang TC',
];

const normalizeFontList = (families: string[]): InstalledSystemFont[] => {
  const seen = new Set<string>();
  const result: InstalledSystemFont[] = [];
  for (const family of families) {
    const trimmed = family.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ family: trimmed });
  }
  return result
    .sort((a, b) => a.family.toLowerCase().localeCompare(b.family.toLowerCase()))
    .slice(0, 200);
};

export async function listInstalledSystemFonts(): Promise<InstalledSystemFont[]> {
  const queryLocalFonts = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  if (typeof queryLocalFonts === 'function') {
    try {
      const fonts = await queryLocalFonts();
      return normalizeFontList(fonts.map((font) => font.family));
    } catch {
      // fall through to the curated list on SecurityError / denied / any failure
    }
  }
  return normalizeFontList(COMMON_SYSTEM_FONTS);
}
