import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import type { ReviewDelivery } from '@mlearn/contracts';
import { createReviewAudioDelivery, type AudioState } from '../../apps/client/src/features/review-media/delivery';

function fixture(overrides: {
  readonly initialDelivery?: ReviewDelivery;
  readonly uri?: (id: string) => Promise<string>;
  readonly onDelivery?: (id: string, value: ReviewDelivery) => Promise<void>;
} = {}) {
  const events: { id: string; value: ReviewDelivery }[] = [];
  const states: AudioState[] = [];
  const requests: string[] = [];
  const owner = createReviewAudioDelivery({
    encounterId: 'encounter-1', mediaId: 'audio-1',
    initialDelivery: overrides.initialDelivery,
    uri: overrides.uri ?? (async id => { requests.push(id); return 'file:///authored.wav'; }),
    onDelivery: overrides.onDelivery ?? (async (id, value) => { events.push({ id, value }); }),
    onState: state => states.push(state),
  });
  return { owner, events, states, requests };
}

test('delivery is encounter-bound and completion requires an actual started event', async () => {
  // Given an authored audio URI admitted by the native owner.
  const { owner, events, requests, states } = fixture();
  await owner.load();
  // When a player ends before starting, then later actually plays to its end.
  await owner.playback({ kind: 'completed' });
  await owner.playback({ kind: 'interrupted' });
  assert.deepEqual(events.map(event => event.value), ['pending']);
  await owner.playback({ kind: 'started' });
  await owner.playback({ kind: 'completed' });
  await owner.playback({ kind: 'interrupted' });
  // Then no grade is invented and terminal notifications are deduplicated.
  assert.deepEqual(requests, ['audio-1']);
  assert.deepEqual(events, ['pending', 'started', 'completed'].map(value => ({ id: 'encounter-1', value })));
  assert.deepEqual(states.at(-1), { kind: 'settled', delivery: 'completed' });
});

test('player is not exposed until pending delivery is durably acknowledged', async () => {
  // Given a blocked durable pending write.
  const entered = Promise.withResolvers<void>();
  const written = Promise.withResolvers<void>();
  const { owner, states, requests } = fixture({ onDelivery: async () => {
    entered.resolve(); await written.promise;
  } });
  // When loading starts but the write has not committed.
  const load = owner.load();
  await entered.promise;
  // Then there is no player URI or media read until the write succeeds.
  assert.deepEqual(states, [{ kind: 'loading' }]);
  assert.deepEqual(requests, []);
  written.resolve();
  await load;
  assert.equal(states.at(-1)?.kind, 'ready');
});

test('completion waits for started persistence without growing repeated event work', async () => {
  // Given a player whose started write is in flight.
  const entered = Promise.withResolvers<void>();
  const written = Promise.withResolvers<void>();
  const delivered: ReviewDelivery[] = [];
  const { owner } = fixture({ onDelivery: async (_id, value) => {
    delivered.push(value);
    if (value === 'started') { entered.resolve(); await written.promise; }
  } });
  await owner.load();
  const starting = owner.playback({ kind: 'started' });
  await entered.promise;
  // When the media ends while that write is in flight.
  const ending = owner.playback({ kind: 'completed' });
  await owner.playback({ kind: 'started' });
  // Then completion is serialized, not dropped or submitted with an old revision.
  assert.deepEqual(delivered, ['pending', 'started']);
  written.resolve();
  await Promise.all([starting, ending]);
  assert.deepEqual(delivered, ['pending', 'started', 'completed']);
});

test('cancel rejects late URI and playback publication', async () => {
  // Given a URI read that does not support physical cancellation.
  const entered = Promise.withResolvers<void>();
  const result = Promise.withResolvers<string>();
  const { owner, events, states } = fixture({ uri: async () => {
    entered.resolve(); return result.promise;
  } });
  const load = owner.load();
  await entered.promise;
  // When the user cancels before that URI returns.
  await owner.cancel();
  result.resolve('file:///late.wav');
  await load;
  await owner.playback({ kind: 'started' });
  // Then the old work cannot resurrect a player.
  assert.deepEqual(events.map(event => event.value), ['pending', 'interrupted']);
  assert.equal(states.some(state => state.kind === 'ready' || state.kind === 'playing'), false);
});

test('unmount interrupts actual playback and rejects stale player events', async () => {
  // Given an admitted playing encounter.
  const interrupted = Promise.withResolvers<void>();
  const deliveries: ReviewDelivery[] = [];
  const { owner, states } = fixture({ onDelivery: async (_id, value) => {
    deliveries.push(value);
    if (value === 'interrupted') interrupted.resolve();
  } });
  await owner.load();
  await owner.playback({ kind: 'started' });
  const before = states.length;
  // When navigation disposes its owner while the native player still has events.
  owner.dispose();
  await interrupted.promise;
  await owner.playback({ kind: 'completed' });
  // Then only interruption persists and no departed view is updated.
  assert.deepEqual(deliveries, ['pending', 'started', 'interrupted']);
  assert.equal(states.length, before);
});

test('missing audio and player failures are failed delivery, not completed', async () => {
  // Given unavailable authored media.
  const missing = fixture({ uri: async () => { throw new Error('Missing authored media'); } });
  // When the native URI resolution fails.
  await missing.owner.load();
  // Then delivery remains explicitly failed.
  assert.deepEqual(missing.events.map(event => event.value), ['pending', 'failed']);
  assert.equal(missing.states.at(-1)?.kind, 'failed');

  const player = fixture();
  await player.owner.load();
  await player.owner.playback({ kind: 'failed', message: 'Unsupported codec' });
  assert.deepEqual(player.events.map(event => event.value), ['pending', 'failed']);
});

test('failed durable writes stop publication and leave retry identity to the command owner', async () => {
  // Given an uncertain started acknowledgement.
  const events: ReviewDelivery[] = [];
  const { owner, states } = fixture({ onDelivery: async (_id, value) => {
    events.push(value);
    if (value === 'started') throw new Error('Write acknowledgement unavailable');
  } });
  await owner.load();
  // When started cannot be acknowledged.
  await owner.playback({ kind: 'started' });
  await owner.playback({ kind: 'completed' });
  owner.dispose();
  // Then no invented terminal write runs after the failed command.
  assert.deepEqual(events, ['pending', 'started']);
  assert.equal(states.at(-1)?.kind, 'failed');
});

test('resuming terminal delivery neither replays audio nor changes retained exposure', async () => {
  // Given persisted terminal conditions on the exact resumed encounter.
  for (const initialDelivery of ['completed', 'interrupted', 'failed'] as const) {
    const { owner, requests, events, states } = fixture({ initialDelivery });
    // When its presentation is restored, without an explicit replay action.
    await owner.load();
    owner.dispose();
    // Then no new delivery mutation or media load resets the original conditions.
    assert.deepEqual(events, []);
    assert.deepEqual(requests, []);
    assert.equal(states.at(-1)?.kind, initialDelivery === 'failed' ? 'failed' : 'settled');
  }
});

test('resuming abandoned started delivery records interruption without fabricating completion', async () => {
  // Given playback that was active at process termination.
  const { owner, events, requests, states } = fixture({ initialDelivery: 'started' });
  // When the exact encounter is resumed.
  await owner.load();
  // Then its interruption is durable before the learner chooses to play again.
  assert.deepEqual(events.map(event => event.value), ['interrupted']);
  assert.deepEqual(requests, []);
  assert.deepEqual(states.at(-1), { kind: 'settled', delivery: 'interrupted' });
});

test('ReviewAudio delivers real authored web audio, interrupts pause and supports explicit replay', { timeout: 30000 }, async () => {
  // Given actual Expo web VideoPlayer/VideoView and an isolated local WAV.
  // Only React Native presentation and Expo's runtime emitter are substituted.
  const wav = Buffer.alloc(44 + 8000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(8000, 40);
  for (let sample = 0; sample < 4000; sample++) {
    wav.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * 440 * sample / 8000)), 44 + sample * 2);
  }
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ReviewAudio } from './apps/client/src/features/review-media/ReviewAudio';
      const root = createRoot(document.getElementById('root'));
      const media = { uri: async () => ${JSON.stringify(`data:audio/wav;base64,${wav.toString('base64')}`)} };
      window.deliveries = [];
      const delivery = async (id, value) => { window.deliveries.push({ id, value }); };
      window.mount = (id, disabled = false, persistedDelivery = 'pending') => root.render(<ReviewAudio
        encounter={{ id, requiredMedia: 'authored-audio', conditions: { delivery: persistedDelivery } }}
        media={media} onDelivery={delivery} disabled={disabled} />);
      window.unmount = () => root.render(null);
    `, resolveDir: resolve('.'), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'expo-web-and-native-presentation',
      setup(builder) {
        // Keep the real public AttachmentPlayer export without pulling unrelated
        // Material-screen navigation/native-picker modules into this owner harness.
        builder.onResolve({ filter: /^\.\.\/material$/ }, () => ({
          path: resolve('apps/client/src/features/material/AttachmentPlayer.tsx'),
        }));
        builder.onResolve({ filter: /^expo-video$/ }, () => ({ path: 'expo-video', namespace: 'web-player' }));
        builder.onLoad({ filter: /.*/, namespace: 'web-player' }, () => ({
          loader: 'ts', resolveDir: resolve('.'), contents: `
            export { useVideoPlayer } from './node_modules/expo-video/src/VideoPlayer.web';
            export { VideoView } from './node_modules/expo-video/src/VideoView.web';
          `,
        }));
        builder.onResolve({ filter: /react-native\/Libraries\/Image\/resolveAssetSource/ }, () => ({
          path: 'asset', namespace: 'asset',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'asset' }, () => ({
          contents: 'export default () => null;',
        }));
        builder.onResolve({ filter: /^(react-native(-unistyles)?|@mlearn\/ui\/.*)$/ }, args => ({
          path: args.path, namespace: 'presentation',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'presentation' }, () => ({
          loader: 'tsx', resolveDir: resolve('.'), contents: `
            import React from 'react';
            export const Platform = { OS: 'web' };
            export const View = ({ children }) => <div>{children}</div>;
            export const Text = ({ children, accessibilityRole }) => <span role={accessibilityRole}>{children}</span>;
            export const Button = ({ label, disabled, onPress }) => <button disabled={disabled} onClick={onPress}>{label}</button>;
            export const StyleSheet = {
              create: factory => factory({ radius: 8, colors: { background: '#ddd' } }),
              flatten: style => style,
            };
          `,
        }));
      },
    }],
  });
  const script = bundle.outputFiles[0];
  assert.ok(script);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: `
      globalThis.expo = { SharedObject: class {
        listeners = new Map();
        addListener(name, callback) {
          const group = this.listeners.get(name) ?? new Set();
          this.listeners.set(name, group); group.add(callback);
          return { remove: () => group.delete(callback) };
        }
        emit(name, ...args) { for (const callback of this.listeners.get(name) ?? []) callback(...args); }
      } };
    ` });
    await page.addScriptTag({ content: script.text });
    await page.evaluate(() => Reflect.get(window, 'mount')('encounter-web'));
    const video = page.locator('video');
    await expect(video).toHaveCount(1);
    // When actual playback reaches its media end (not an injected end event).
    await video.evaluate(element => new Promise<void>((resolve, reject) => {
      if (!(element instanceof HTMLVideoElement)) { reject(new TypeError('Expected video element')); return; }
      element.addEventListener('ended', () => resolve(), { once: true });
      element.addEventListener('error', () => reject(new Error('WAV playback failed')), { once: true });
      void element.play().catch(reject);
    }));
    // Then exactly pending/started/completed persists for the admitted encounter.
    await expect(page.getByRole('button', { name: 'Play audio again' })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'deliveries')), [
      { id: 'encounter-web', value: 'pending' },
      { id: 'encounter-web', value: 'started' },
      { id: 'encounter-web', value: 'completed' },
    ]);
    await page.getByRole('button', { name: 'Play audio again' }).click();
    await expect(video).toHaveCount(1);
    await video.evaluate(element => new Promise<void>((resolve, reject) => {
      if (!(element instanceof HTMLVideoElement)) { reject(new TypeError('Expected video element')); return; }
      element.addEventListener('playing', () => { element.pause(); resolve(); }, { once: true });
      void element.play().catch(reject);
    }));
    await expect(page.getByRole('button', { name: 'Play audio again' })).toBeVisible();
    const deliveries = await page.evaluate(() => Reflect.get(window, 'deliveries'));
    assert.deepEqual(deliveries.slice(3), [
      { id: 'encounter-web', value: 'pending' },
      { id: 'encounter-web', value: 'started' },
      { id: 'encounter-web', value: 'interrupted' },
    ]);
    await page.evaluate(() => Reflect.get(window, 'mount')('encounter-completed', false, 'completed'));
    await expect(page.getByRole('button', { name: 'Play audio again' })).toBeVisible();
    await expect(video).toHaveCount(0);
    assert.equal((await page.evaluate(() => Reflect.get(window, 'deliveries'))).length, 6);
    await page.evaluate(() => Reflect.get(window, 'mount')('encounter-abandoned', false, 'started'));
    await expect(page.getByRole('button', { name: 'Play audio again' })).toBeVisible();
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'deliveries'))).slice(6), [
      { id: 'encounter-abandoned', value: 'interrupted' },
    ]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
