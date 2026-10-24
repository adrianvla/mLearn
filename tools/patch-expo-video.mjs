import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ExpoVideo 57.0.5 leaves its manual appearance transition open. On iOS 27,
// paused AVKit input can stop after source reopening. Remove this and the
// source-build override when the upstream binary passes the native input flow.
export function patchVideoView(version, source) {
  if (version !== '57.0.5') throw new Error(`Revalidate the ExpoVideo lifecycle repair for ${version}`);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest === 'a0bf4cc7557d9092b7bd24054c6e774bcd988176091ed085bb0b11e2f6c0c705') return source;
  if (digest !== 'd4296ca377d39150928d2cb58375bd1161954f9fcc3993ef5a48de4bd6da5a0b') {
    throw new Error('Unexpected ExpoVideo source; revalidate the lifecycle repair');
  }
  return source.replace(
    '    playerViewController.beginAppearanceTransition(self.window != nil, animated: true)',
    '    playerViewController.beginAppearanceTransition(self.window != nil, animated: true)\n    playerViewController.endAppearanceTransition()',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dependency = new URL('../node_modules/expo-video/', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', dependency), 'utf8'));
  const target = new URL('ios/VideoView.swift', dependency);
  const source = readFileSync(target, 'utf8');
  const patched = patchVideoView(version, source);
  if (patched !== source) writeFileSync(target, patched);
}
