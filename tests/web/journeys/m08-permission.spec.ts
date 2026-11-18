import type { Page } from '@playwright/test';
import { test, expect, installPackage, startSpeechFixture } from './fixture';
import { createConversation, openMessenger } from './messenger';
import { denyMicrophone } from './microphone';

async function setUpVoice(page: Page, endpoint: string) {
  await page.goto('/settings?section=voice');
  await page.getByRole('textbox', { name: 'Speech service address' }).fill(endpoint);
  await page.getByRole('textbox', { name: 'Speech model' }).fill('fixture-speech');
  await page.getByRole('textbox', { name: 'Listening model' }).fill('fixture-listen');
  await page.getByRole('textbox', { name: 'Default voice' }).fill('river');
  await page.getByRole('button', { name: 'Save voice settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save voice settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test voice', exact: true }).click();
  await expect(page.getByText(/Played with fixture-speech · river/)).toBeVisible();
}

test('M08 calls explain a denied microphone permission in place', async ({ page, nativeCore }) => {
  test.setTimeout(180_000);
  const speech = await startSpeechFixture();
  try {
    await denyMicrophone(page);
    await installPackage(page);
    await setUpVoice(page, speech.url);
    await openMessenger(page, nativeCore, ['Ana']);
    await createConversation(page, 'Quiet call', 'Separate history', ['Ana']);
    await page.getByRole('button', { name: 'Call', exact: true }).click();
    await expect(page.getByTestId('call-panel').getByText('Allow microphone access to talk.')).toBeVisible({ timeout: 30_000 });
  } finally {
    await speech.close();
  }
});
