/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../tools/runtime-browser-qa.mjs';

// The browser substitutes only the host transport. Profile mutations, signed
// package installation, language execution, jobs and traces run in real Rust.
// The external text provider is controlled; native window/media/clipboard are
// deliberately not claimed by this suite.
test('normal Messenger UI consumes actual native content and prepared language on desktop and phone', async ({ page }, info) => {
  test.setTimeout(120_000);
  const backend = await startRuntimeBrowserQa({
    profile: `.mlearn/m03-m07/m07-messenger/browser-${randomUUID()}`,
  });
  try {
    await attachRuntimeBrowserQa(page, backend.url);
    // Exercise the real macOS overlay-chrome reservation on every CI host.
    await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }));
    await page.setViewportSize({ width: 1212, height: 872 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Get language packages', exact: true }).click();
    await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
    await page.getByRole('button', { name: /^Install .*English/ }).click();
    await expect(page.getByRole('button', { name: /^Update .*English/ })).toBeVisible();
    const document = JSON.parse(await backend.invoke('runtime_execute', {
      request: JSON.stringify({ type: 'open_document',
        path: resolve('tests/fixtures/reader/continuity.txt'), packageId: 'org.mlearn.english' }),
    }));
    expect(document.type).toBe('document');
    await page.goto('/');
    // The preview must receive pointer input instead of the stretched import action.
    await page.getByRole('button', { name: 'Continue continuity.txt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'continuity.txt', exact: true })).toBeVisible();
    await page.goto('/');
    await page.getByRole('button', { name: 'Resume continuity.txt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'continuity.txt', exact: true })).toBeVisible();
    await page.goto('/');
    const activityBounds = async () => {
      const bounds = await Promise.all(['read', 'watch', 'conversation', 'review'].map(async name => {
        const activity = page.getByTestId(`home-${name}-activity`);
        await expect(activity).toBeVisible();
        return activity.boundingBox();
      }));
      return bounds.map(bound => {
        if (!bound) throw new Error('Home activity has no layout bounds');
        return bound;
      });
    };
    const [read, watch, conversation, review] = await activityBounds();
    expect(read.y).toBe(watch.y);
    expect(watch.y).toBe(conversation.y);
    expect(read.x + read.width).toBeLessThanOrEqual(watch.x);
    expect(watch.x + watch.width).toBeLessThanOrEqual(conversation.x);
    expect(review.y).toBeGreaterThanOrEqual(read.y + read.height);
    await page.screenshot({ path: info.outputPath('home-desktop-activities.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const phoneActivities = await activityBounds();
    for (let index = 0; index < phoneActivities.length; index++) {
      const activity = phoneActivities[index];
      expect(activity.x).toBeGreaterThanOrEqual(0);
      expect(activity.x + activity.width).toBeLessThanOrEqual(390);
      if (index > 0) {
        const previous = phoneActivities[index - 1];
        expect(activity.y).toBeGreaterThanOrEqual(previous.y + previous.height);
      }
    }
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    const messengerActivity = page.getByRole('button', { name: 'Messenger', exact: true });
    await expect(messengerActivity).toBeVisible();
    await messengerActivity.focus();
    await expect(messengerActivity).toBeFocused();
    await messengerActivity.click();
    await expect(page.getByRole('button', { name: 'People', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.setViewportSize({ width: 1212, height: 872 });
    await page.getByRole('button', { name: 'People', exact: true }).click();
    await page.getByRole('button', { name: 'New person', exact: true }).click();
    const person = page.getByRole('dialog', { name: 'New person', exact: true });
    await person.getByRole('textbox', { name: 'Name', exact: true }).fill('Coach');
    await person.getByRole('textbox', { name: 'Description', exact: true }).fill('Give a short reply in English.');
    await person.getByRole('button', { name: 'Save person', exact: true }).click();
    await expect(person).toBeHidden();
    await page.getByRole('button', { name: 'Message', exact: true }).click();
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
    await page.getByRole('button', { name: 'Provider', exact: true }).click();
    const provider = page.getByRole('dialog', { name: 'Conversation provider', exact: true });
    await provider.getByRole('textbox', { name: 'Chat completions endpoint', exact: true }).fill(`${backend.url}/v1`);
    await provider.getByRole('textbox', { name: 'Model', exact: true }).fill('fixture-local');
    const savedProvider = page.waitForResponse(response => {
      if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
      const payload = response.request().postDataJSON();
      return typeof payload.args?.request === 'string'
        && JSON.parse(payload.args.request).command?.action === 'save_provider_settings';
    });
    await provider.getByRole('button', { name: 'Save endpoint and model', exact: true }).click();
    const saved = await (await savedProvider).json();
    expect(JSON.parse(saved.value)).toMatchObject({
      type: 'conversation', result: { kind: 'provider_settings', settings: {
        endpoint: `${backend.url}/v1`, model: 'fixture-local',
      } },
    });
    await expect(provider.getByRole('button', { name: 'Save endpoint and model', exact: true })).toBeEnabled();
    await provider.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    const emptySize = await composer.boundingBox();
    if (!emptySize) throw new Error('Message composer has no visible bounds');
    const watchHeight = (grow: boolean) => composer.evaluateHandle((node, { baseline, grow }) => {
      let timer: ReturnType<typeof setTimeout>;
      let observer: ResizeObserver;
      const changed = new Promise<number | null>(resolve => {
        const finish = (height: number | null) => { observer.disconnect(); clearTimeout(timer); resolve(height); };
        observer = new ResizeObserver(() => {
          const height = node.getBoundingClientRect().height;
          if (grow ? height > baseline + 1 : height <= baseline + 1) finish(height);
        });
        observer.observe(node);
        timer = setTimeout(() => finish(null), 5000);
      });
      return { changed };
    }, { baseline: emptySize.height, grow });
    const growing = await watchHeight(true);
    await composer.fill('First line\nSecond line\nThird line');
    expect(await growing.evaluate(value => value.changed)).not.toBeNull();
    await growing.dispose();
    const shrinking = await watchHeight(false);
    await composer.fill('Say a short sentence.');
    expect(await shrinking.evaluate(value => value.changed)).not.toBeNull();
    await shrinking.dispose();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toBeVisible();
    const showAnalysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
    await expect(showAnalysis).toBeEnabled();
    expect(backend.metadata().counts['conversation:analyze_visible_messages']).toBeGreaterThan(0);
    await showAnalysis.click();
    const child = page.getByRole('button', { name: 'Children: untracked', exact: true });
    await expect(child).toBeVisible();
    expect(backend.metadata().providerRequests).toBe(1);
    await page.screenshot({ path: info.outputPath('messenger-desktop.png') });
    await child.click();
    const inspector = page.getByTestId('inspector-panel');
    await expect(inspector.getByText('child', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('messenger-desktop-inspector.png') });
    await inspector.getByRole('button', { name: /^Close Inspect/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const narrowBack = await page.getByRole('button', { name: 'Chats and People', exact: true }).boundingBox();
    if (!narrowBack) throw new Error('Narrow conversation navigation has no visible bounds');
    expect(narrowBack.x).toBeGreaterThanOrEqual(80);
    await expect(composer).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('messenger-phone.png') });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const savedTheme = page.waitForResponse(response => {
      if (response.url() !== `${backend.url}/invoke` || response.request().method() !== 'POST') return false;
      const payload = response.request().postDataJSON();
      return typeof payload.args?.request === 'string' && JSON.parse(payload.args.request).type === 'save_theme';
    });
    await page.getByRole('combobox', { name: /^Select theme/ }).click();
    await page.getByRole('option', { name: 'Dark Quartz', exact: true }).click();
    expect(JSON.parse((await (await savedTheme).json()).value)).toMatchObject({ type: 'saved' });
    await expect(page.getByText('Theme saved.', { exact: true })).toBeVisible();
    await backend.crashRestart();
    await page.goto('/');
    await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Coach', exact: true }).click();
    await expect(page.getByTestId('conversation-history').getByText('Children walked home.', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('messenger-phone-dark-restarted.png') });
    await page.setViewportSize({ width: 1212, height: 872 });
    await page.screenshot({ path: info.outputPath('messenger-desktop-dark-restarted.png') });
    const darkAnalysis = page.getByRole('button', { name: 'Show analysis', exact: true }).last();
    await expect(darkAnalysis).toBeEnabled();
    await darkAnalysis.click();
    await page.getByRole('button', { name: 'Children: untracked', exact: true }).click();
    await expect(inspector.getByText('child', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('messenger-desktop-dark-inspector.png') });
    const snapshot = JSON.parse(await backend.invoke('runtime_execute', { request: JSON.stringify({ type: 'snapshot' }) }));
    expect(snapshot.snapshot.theme.id).toBe('mlearn.dark-quartz');
    await info.attach('native-source-and-profile.json', {
      body: JSON.stringify({ transport: 'real_core_browser_adapter', profile: backend.profile,
        nativePid: backend.pid, catalog: backend.catalogUrl, snapshot, activity: backend.metadata(),
        uiScripts: await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => (node as HTMLScriptElement).src)) }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await info.attach('native-transport-final.json', {
      body: JSON.stringify({ profile: backend.profile, nativePid: backend.pid,
        activity: backend.metadata() }, null, 2),
      contentType: 'application/json',
    });
    await backend.close();
  }
});
