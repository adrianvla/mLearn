import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, installPackage, execute, startSpeechFixture, type NativeCore } from './fixture';
import { useGeneratedMicrophone } from './microphone';
import { createConversation, openMessenger } from './messenger';


async function setUpVoice(page: Page, endpoint: string) {
  await page.goto('/settings?section=voice');
  await page.getByRole('textbox', { name: 'Speech service address' }).fill(endpoint);
  await page.getByRole('textbox', { name: 'Speech model' }).fill('fixture-speech');
  await page.getByRole('textbox', { name: 'Listening model' }).fill('fixture-listen');
  await page.getByRole('textbox', { name: 'Default voice' }).fill('river');
  await page.getByRole('button', { name: 'Save voice settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save voice settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test voice', exact: true }).click();
  await expect(page.getByText('Played with the saved voice.', { exact: true })).toBeVisible();
}

async function openWatchWord(page: Page, native: NativeCore, directory: string) {
  const video = path.join(directory, 'clip.mp4');
  await writeFile(video, 'pronunciation journey source identity');
  await writeFile(path.join(directory, 'clip.srt'), '1\n00:00:00,000 --> 00:00:30,000\nThe children walked home.\n');
  const opened = await execute(native, { type: 'open_source', path: video, packageId: 'org.mlearn.english' });
  await execute(native, { type: 'attach_subtitles', sourceId: opened.window.source.id, path: path.join(directory, 'clip.srt') });
  await page.goto('/');
  await page.getByRole('button', { name: `Continue ${opened.window.source.title}`, exact: true }).click();
  await page.getByTestId('subtitle-window').getByRole('button', { name: /^children: / }).click();
  return page.getByTestId('inspector-panel');
}

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });


  // PLAN M08 Review: pronounce an Inspector item, run an audio probe and make an interruptible
  // conversation call; verify generated versus delivered transcript and permission/error paths.
  test('M08 shared speech: pronunciation, provider failure, interruptible call with delivered transcript', async ({ page, nativeCore }, info) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(20_000);
    const speech = await startSpeechFixture();
    const directory = await mkdtemp(path.join(tmpdir(), 'mlearn-m08-'));
    try {
      await useGeneratedMicrophone(page);
      await installPackage(page);
      // Without a voice provider the Inspector says so in place instead of pretending to speak.
      let inspector = await openWatchWord(page, nativeCore, directory);
      await inspector.getByRole('button', { name: 'Play pronunciation', exact: true }).click();
      await expect(inspector.getByTestId('pronunciation-no-voice')).toBeVisible();
      await page.screenshot({ path: info.outputPath('m08-no-voice.png') });

      await setUpVoice(page, speech.url);
      inspector = await openWatchWord(page, nativeCore, directory);
      await inspector.getByRole('button', { name: 'Play pronunciation', exact: true }).click();
      await expect(inspector.getByRole('button', { name: 'Stop pronunciation', exact: true })).toBeVisible();
      expect(speech.requests.some(request => request.path === '/v1/audio/speech' && request.body.includes('"voice":"river"'))).toBe(true);
      await inspector.getByRole('button', { name: 'Stop pronunciation', exact: true }).click();

      // Review voices the same item through the same speech provider, only once it is revealed.
      await inspector.getByRole('button', { name: 'Capture children', exact: true }).click();
      await expect(inspector.getByRole('button', { name: 'Open saved children: revision 1', exact: true })).toBeVisible();
      await page.goto('/');
      await page.getByTestId('home-open-review').click();
      await page.getByRole('button', { name: 'Session size', exact: true }).click();
      await page.getByRole('textbox', { name: 'Finite Review limit', exact: true }).fill('1');
      await page.getByRole('button', { name: 'Start finite Review', exact: true }).click();
      await expect(page.getByTestId('review-cue')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Play pronunciation', exact: true })).toHaveCount(0);
      const spokenBefore = speech.requests.filter(request => request.path === '/v1/audio/speech').length;
      await page.getByRole('button', { name: 'Reveal', exact: true }).click();
      await page.getByRole('button', { name: 'Play pronunciation', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop pronunciation', exact: true })).toBeVisible();
      const spoken = speech.requests.filter(request => request.path === '/v1/audio/speech');
      expect(spoken.length).toBe(spokenBefore + 1);
      expect(spoken.at(-1)?.body).toContain('children');
      await page.screenshot({ path: info.outputPath('m08-review-pronunciation.png') });
      await page.getByRole('button', { name: 'Stop pronunciation', exact: true }).click();

      // An interruptible call: what was heard is recorded separately from what was generated.
      await openMessenger(page, nativeCore, ['Ana']);
      await createConversation(page, 'Evening call', 'Separate history', ['Ana']);
      speech.transcript = 'Hello Ana, how was your day?';
      await page.getByRole('button', { name: 'Call', exact: true }).click();
      const call = page.getByTestId('call-panel');
      await expect(call.getByText('Speaking')).toBeVisible({ timeout: 60_000 });
      const history = page.getByTestId('conversation-history');
      await expect(history.getByText('Hello Ana, how was your day?', { exact: true })).toBeVisible();
      await call.getByRole('button', { name: 'Interrupt', exact: true }).click();
      // Playback time, not recognized words, is known: the interrupted share is stated as approximate.
      await expect(history.getByText(/^Interrupted after about \d+% of the reply$/)).toBeVisible({ timeout: 20_000 });
      await expect(history.getByText('Children walked home.', { exact: true })).toBeVisible();
      // A reply can be heard again through the same shared speech.
      const replay = history.getByRole('button', { name: 'Replay message', exact: true }).last();
      await replay.click();
      await expect(history.getByRole('button', { name: 'Stop replay', exact: true })).toBeVisible({ timeout: 20_000 });
      await history.getByRole('button', { name: 'Stop replay', exact: true }).click();
      await page.screenshot({ path: info.outputPath('m08-interrupted.png') });

      // Provider failure pauses the call with one plain sentence and a retry that resumes it.
      speech.fail = true;
      await expect(call.getByRole('alert')).toBeVisible({ timeout: 60_000 });
      expect(await call.getByRole('alert').innerText()).not.toMatch(/HTTP|503|speech_failed/);
      speech.fail = false;
      await call.getByRole('button', { name: 'Retry call', exact: true }).click();
      await expect(call.getByText(/Listening…|Understanding…|Replying…|Speaking/)).toBeVisible();
      await call.getByRole('button', { name: 'End call', exact: true }).click();
      await expect(call).toBeHidden();
    } finally {
      await speech.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
