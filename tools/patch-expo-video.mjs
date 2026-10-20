import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// expo-video 57.0.5 begins an appearance transition on every window move but
// never ends it. On iOS 27, reopening a source can leave AVKit transport absent.
// The unchanged native Watch flow fails without this fix and passes with it.
// Remove when the upstream lifecycle is balanced and that flow passes unpatched.
const manifest = createRequire(import.meta.url).resolve('expo-video/package.json');
const { version } = JSON.parse(await readFile(manifest, 'utf8'));
if (version !== '57.0.5') throw new Error(`Review the native video lifecycle workaround for expo-video ${version}.`);
const file = path.join(path.dirname(manifest), 'ios/VideoView.swift');
const source = await readFile(file, 'utf8');
const signature = '  public override func didMoveToWindow() {';
const begin = '    playerViewController.beginAppearanceTransition(self.window != nil, animated: true)';
const start = source.indexOf(signature);
const end = source.indexOf('\n  public override func safeAreaInsetsDidChange()', start);
if (start < 0 || end < start) throw new Error('Unexpected expo-video window lifecycle.');
const method = source.slice(start, end);
const hasSuper = method.includes('    super.didMoveToWindow()');
const hasEnd = method.includes('    playerViewController.endAppearanceTransition()');
if (hasSuper && hasEnd) process.exit(0);
if (hasSuper || hasEnd || !method.includes(begin)) throw new Error('Unexpected expo-video appearance transition.');
const patched = method.replace(signature, `${signature}\n    super.didMoveToWindow()`)
  .replace(begin, `${begin}\n    playerViewController.endAppearanceTransition()`);
await writeFile(file, source.slice(0, start) + patched + source.slice(end));
console.log('Balanced expo-video iOS window appearance transitions.');
