import { isPackageInstallStatus, RuntimeError } from '@mlearn/runtime-client';
import type { PackageInstallStatus } from '@mlearn/contracts';

type Model = { readonly id: string; readonly label: string; readonly target: string; readonly revision: string;
    readonly installedRevision: string | null; readonly installed: boolean; readonly reason: string | null; readonly bytes: number };
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum = 128): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0');
const nullable = (value: unknown, maximum: number): value is string | null => value === null || text(value, maximum);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const archiveBytes = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2 * 1024 ** 3;

/** Desktop host projection only. Rust authenticates profiles, chooses actual
 * resources and owns installation/leases. No executable paths reach callers.
 */
export function createOcrModelsHost(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
    const malformed = () => new RuntimeError('protocol', 'Malformed native OCR model response.');
    function status(value: unknown): PackageInstallStatus | null {
        if (!object(value) || value.type !== 'package_install_status'
            || value.status !== null && !isPackageInstallStatus(value.status, 4 * 1024 ** 3)) throw malformed();
        return value.status;
    }
    async function act(command: string, profileId: string) {
        const result = await invoke(command, { profileId });
        if (result !== null && result !== undefined) throw malformed();
    }
    return {
        async list() {
            const value = await invoke('ocr_models');
            if (!object(value) || !Array.isArray(value.models) || value.models.length > 8
                || !nullable(value.catalogReason, 4096) || JSON.stringify(value).length > 524288) throw malformed();
            const items: Model[] = [];
            for (const item of value.models) {
                if (!object(item) || !object(item.profile) || !text(item.profile.id)
                    || !text(item.profile.label) || !text(item.profile.target) || !digest(item.profileRevision)
                    || !(item.installedRevision === null || digest(item.installedRevision))
                    || typeof item.installed !== 'boolean' || item.installed !== (item.installedRevision !== null)
                    || !nullable(item.reason, 4096) || !object(item.profile.runtime) || !object(item.profile.models)
                    || !archiveBytes(item.profile.runtime.byteLength) || !archiveBytes(item.profile.models.byteLength))
                    throw malformed();
                items.push({ id: item.profile.id, label: item.profile.label, target: item.profile.target,
                    revision: item.profileRevision, installedRevision: item.installedRevision, installed: item.installed,
                    reason: item.reason, bytes: item.profile.runtime.byteLength + item.profile.models.byteLength });
            }
            if (new Set(items.map(item => item.id)).size !== items.length) throw malformed();
            return { items, catalogReason: value.catalogReason, installation: status(value.installation) };
        },
        async status() { return status(await invoke('ocr_model_install_status')); },
        install: (profileId: string) => act('install_ocr_model', profileId),
        remove: (profileId: string) => act('remove_ocr_model', profileId),
        async cancel() { return status(await invoke('cancel_ocr_model_install')); },
        async test(profileId: string) {
            const value = await invoke('test_ocr_model', { profileId });
            if (!object(value) || typeof value.detectedRegions !== 'number' || !Number.isInteger(value.detectedRegions)
                || value.detectedRegions < 0 || value.detectedRegions > 512
                || typeof value.elapsedMs !== 'number' || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0
                || !Array.isArray(value.rawRecognition) || value.rawRecognition.length > 512
                || !value.rawRecognition.every(item => typeof item === 'string' && item.length <= 32768)
                || JSON.stringify(value).length > 524288) throw malformed();
            return { detectedRegions: value.detectedRegions, rawRecognition: value.rawRecognition.join('\n'), elapsedMs: value.elapsedMs };
        },
    };
}
export type OcrModelsHost = ReturnType<typeof createOcrModelsHost>;
