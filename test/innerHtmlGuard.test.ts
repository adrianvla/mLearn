import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const RENDERER_DIR = path.join(REPO_ROOT, 'src', 'renderer');

// Regex: innerHTML={...} where the expression does NOT start with sanitizeHtml(
// \s* tolerates newlines/indentation in multiline JSX.
const UNSANITIZED_RE = /innerHTML=\{(?!\s*sanitizeHtml\()/;

// Files on this list are trusted because they assign only static/controlled content.
// Each entry includes a one-line justification. When a file is renamed or deleted,
// the stale-entry check below fails so the list stays accurate.
const ALLOWLIST: { file: string; reason: string }[] = [
  {
    file: 'src/renderer/windows/settings/MobileSettingsView.tsx',
    reason: 'static app icon SVG strings (backArrow)',
  },
  {
    file: 'src/renderer/components/mobile/MobileLayout/MobileLayout.tsx',
    reason: 'static app icon SVG strings',
  },
  {
    file: 'src/renderer/components/mobile/MobileHeader/MobileHeader.tsx',
    reason: 'static app icon SVG strings',
  },
  {
    file: 'src/renderer/components/mobile/BottomTabBar/BottomTabBar.tsx',
    reason: 'static app icon SVG strings (tabIcons)',
  },
  {
    file: 'src/renderer/components/common/EulaModal/EulaModal.tsx',
    reason: 'app-bundled legal markdown',
  },
  {
    file: 'src/renderer/windows/mobile/routes/LicensesRoute.tsx',
    reason: 'app-bundled license texts',
  },
  {
    file: 'src/renderer/components/language-specific/JapanesePitchAccentOverlay.tsx',
    reason:
      'markup built from sha256-verified language package prosody data (numbers/class strings only)',
  },
];

/** Recursively collect all .tsx file paths under dir, excluding test files. */
function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsxFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.test.ts')
    ) {
      results.push(full);
    }
  }
  return results;
}

describe('innerHTML guard (issue #30)', () => {
  // -----------------------------------------------------------------------
  // Stale-entry detection: every allowlist entry must still exist on disk.
  // -----------------------------------------------------------------------
  it('every allowlist entry exists on disk', () => {
    const missing = ALLOWLIST.filter(
      (entry) => !fs.existsSync(path.join(REPO_ROOT, entry.file)),
    ).map((entry) => entry.file);

    // Also flag entries that are just test files (shouldn't be in the allowlist).
    const isTest = ALLOWLIST.filter(
      (entry) =>
        entry.file.endsWith('.test.tsx') || entry.file.endsWith('.test.ts'),
    ).map((entry) => entry.file);

    const messages: string[] = [];
    if (missing.length > 0) {
      messages.push(
        `Stale allowlist entries — file no longer exists:\n  ${missing.join('\n  ')}`,
      );
    }
    if (isTest.length > 0) {
      messages.push(
        `Test files should not be in the allowlist (they are auto-excluded):\n  ${isTest.join('\n  ')}`,
      );
    }
    expect(messages, messages.join('\n')).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Core guard: no unsanitized innerHTML in renderer production code.
  // -----------------------------------------------------------------------
  it('no unsanitized innerHTML={...} JSX sinks in renderer production code', () => {
    const allTsx = collectTsxFiles(RENDERER_DIR);
    const allowlistSet = new Set(
      ALLOWLIST.map((entry) => path.resolve(REPO_ROOT, entry.file)),
    );

    const violations: string[] = [];

    for (const file of allTsx) {
      if (allowlistSet.has(file)) continue;

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (UNSANITIZED_RE.test(lines[i])) {
          const rel = path.relative(REPO_ROOT, file);
          violations.push(`  ${rel}:${i + 1}`);
        }
      }
    }

    expect(
      violations,
      [
        'Found unsanitized innerHTML={...} usage(s) in renderer production code.',
        'Use <SafeHtml> from components/common or sanitizeHtml() from renderer/utils — see issue #30.',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });
});
