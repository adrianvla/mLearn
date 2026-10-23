/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPackageInstallStatus, RuntimeError } from '@mlearn/runtime-client';
import { createOcrModelsHost } from '../../apps/client/src/host/ocrModels';

const phase = { command: { commandId: 'native-install', pluginId: 'profile' }, phase: 'downloading',
    downloadedBytes: 800_000_000, totalBytes: 1_328_861_776, message: null };
const row = { profile: { id: 'profile', label: 'Native detector and recognizer', target: 'macos-aarch64',
    runtime: { path: 'runtime.tar.gz', byteLength: 875_274_349 },
    models: { path: 'models.tar.gz', byteLength: 453_587_427 } },
    profileRevision: 'a'.repeat(64), installed: true, installedRevision: 'a'.repeat(64), reason: null };
const inventory = { models: [row], catalogReason: null,
    installation: { type: 'package_install_status', status: phase } };

test('native OCR inventory projects bounded metadata and large native transfers without weakening language limits', async () => {
    const commands: { command: string; args?: Record<string, unknown> }[] = [];
    const host = createOcrModelsHost(async (command, args) => {
        commands.push({ command, args });
        if (command === 'ocr_models') return inventory;
        if (command === 'ocr_model_install_status' || command === 'cancel_ocr_model_install') return inventory.installation;
        if (command === 'test_ocr_model') return { detectedRegions: 2, rawRecognition: ['first', 'second'], elapsedMs: 1234 };
        return null;
    });
    const result = await host.list();
    assert.deepEqual(result.items, [{ id: 'profile', label: row.profile.label, target: row.profile.target,
        revision: row.profileRevision, installedRevision: row.installedRevision, installed: true,
        reason: null, bytes: 1_328_861_776 }]);
    assert.deepEqual(await host.status(), phase);
    assert.equal(isPackageInstallStatus(phase), false);
    assert.equal(isPackageInstallStatus(phase, 4 * 1024 ** 3), true);
    await host.install('profile'); await host.remove('profile'); await host.cancel();
    assert.deepEqual(await host.test('profile'), { detectedRegions: 2, rawRecognition: 'first\nsecond', elapsedMs: 1234 });
    assert.deepEqual(commands.filter(item => item.command === 'install_ocr_model' || item.command === 'remove_ocr_model'),
        [{ command: 'install_ocr_model', args: { profileId: 'profile' } },
            { command: 'remove_ocr_model', args: { profileId: 'profile' } }]);
});

test('native OCR host rejects duplicate profiles, inconsistent state and malformed transfer/model outputs', async () => {
    let value: unknown = inventory;
    const host = createOcrModelsHost(async () => value);
    for (const invalid of [
        { ...inventory, models: [row, row] },
        { ...inventory, models: [{ ...row, installedRevision: null }] },
        { ...inventory, models: [{ ...row, profileRevision: 'unverified' }] },
        { ...inventory, installation: { type: 'package_install_status', status: { ...phase, totalBytes: 5 * 1024 ** 3 } } },
        { ...inventory, models: [{ ...row, profile: { ...row.profile, runtime: { byteLength: -1 } } }] },
    ]) {
        value = invalid;
        await assert.rejects(host.list(), (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
    }
    value = { detectedRegions: 1, rawRecognition: [null], elapsedMs: 1 };
    await assert.rejects(host.test('profile'), (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol');
});
