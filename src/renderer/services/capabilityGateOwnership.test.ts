/**
 * Guards the consolidation itself rather than any one behaviour.
 *
 * The bug this replaced was not a wrong message or a wrong branch: it was
 * fifteen call sites each deciding independently what an unavailable
 * capability looks like, and they had already drifted into four different
 * answers. Any test that only checks the shared module would keep passing
 * while a new surface grew its own gate back, which is how the original
 * spread in the first place.
 *
 * So this walks the renderer and fails on the three shapes that recreate the
 * class: an OS alert, and a direct readiness check whose only response is to
 * give up silently.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const RENDERER_ROOT = join(__dirname, '..');
const SOURCE_FILE = /\.(ts|tsx)$/;

function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return rendererSources(full);
    if (!SOURCE_FILE.test(entry.name) || full.includes('.test.')) return [];
    return [full];
  });
}

const files = rendererSources(RENDERER_ROOT).filter(
  (file) => !file.endsWith('capabilityUnavailable.ts'),
);

describe('unavailable capabilities are reported through one owner', () => {
  it('finds renderer sources to check', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('no surface raises an OS alert', () => {
    // `alert` is a blocking window the toast layer cannot reach, cannot style
    // and cannot attach a recovery action to. It is what made the same refusal
    // look different on three surfaces.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      // Strip line comments so prose about the old behaviour is not a match.
      const code = source.replace(/\/\/.*$/gm, '');
      if (/(^|[^.\w])alert\s*\(/.test(code)) {
        offenders.push(relative(RENDERER_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no surface checks LLM readiness and then silently gives up', () => {
    // The overlay's "explain phrase" case did exactly this: the click was
    // consumed and nothing at all was rendered, which a user cannot tell apart
    // from a broken menu item.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const code = source.replace(/\/\/.*$/gm, '');
      const pattern = /if\s*\(\s*!\s*isLLMReady\([^)]*\)\s*\)\s*\{\s*break\s*;?\s*\}/g;
      if (pattern.test(code)) offenders.push(relative(RENDERER_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('the shared owner is the only place that maps a capability to its copy', () => {
    // If a second module starts mapping capabilities to message keys, the two
    // will drift and the class is back.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith('capabilityUnavailable.ts')) continue;
      const source = readFileSync(file, 'utf-8');
      if (/CapabilityUnavailable\./.test(source)) {
        offenders.push(relative(RENDERER_ROOT, file));
      }
    }
    // One caller is allowed to name the key directly: a form that reports the
    // refusal inline beside its input, where a toast would be wrong.
    expect(offenders.length).toBeLessThanOrEqual(1);
  });
});
