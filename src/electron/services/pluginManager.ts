import fs from 'fs';
import path from 'path';
import { PLUGIN_API_VERSION } from '../../shared/plugins/constants';
import {
  PluginManifest,
  PluginState,
  PluginCapability,
  PluginPermission,
} from '../../shared/plugins/types';
import { getUserDataPath } from '../utils/platform';

const MANIFEST_FILE_NAME = 'plugin.json';
const DEFAULT_PLUGIN_MAIN = 'dist/main.js';

const VALID_CAPABILITIES: PluginCapability[] = ['language', 'ui-panel', 'integration'];
const VALID_PERMISSIONS: PluginPermission[] = ['kv-store', 'open-window', 'http'];

export interface PersistedPluginState {
  disabled: string[];
  permissionsGranted: string[];
}

export interface PluginEntry {
  manifest: PluginManifest;
  state: PluginState;
  pluginPath: string;
  moduleExports?: Record<string, unknown>;
}

const registry = new Map<string, PluginEntry>();

function shouldActivatePlugin(entry: PluginEntry): boolean {
  return entry.state.status === 'pending' && entry.state.permissionsGranted;
}

function activateIfPermitted(entry: PluginEntry): void {
  if (!shouldActivatePlugin(entry)) {
    return;
  }

  activatePlugin(entry);
}

export function getPluginsDir(): string {
  return path.join(getUserDataPath(), 'plugins');
}

export function getPluginStatePath(): string {
  return path.join(getUserDataPath(), 'plugin-state.json');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizePersistedState(state: PersistedPluginState): PersistedPluginState {
  return {
    disabled: [...new Set(state.disabled)],
    permissionsGranted: [...new Set(state.permissionsGranted)],
  };
}

export function loadPersistedState(): PersistedPluginState {
  const statePath = getPluginStatePath();

  try {
    if (!fs.existsSync(statePath)) {
      return { disabled: [], permissionsGranted: [] };
    }

    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (!isPlainObject(parsed)) {
      return { disabled: [], permissionsGranted: [] };
    }

    return normalizePersistedState({
      disabled: isStringArray(parsed.disabled) ? parsed.disabled : [],
      permissionsGranted: isStringArray(parsed.permissionsGranted) ? parsed.permissionsGranted : [],
    });
  } catch (error) {
    console.error('[plugins] Failed to load persisted plugin state:', error);
    return { disabled: [], permissionsGranted: [] };
  }
}

export function savePersistedState(state: PersistedPluginState): void {
  const statePath = getPluginStatePath();
  const normalized = normalizePersistedState(state);

  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(normalized, null, 2), 'utf-8');
  } catch (error) {
    console.error('[plugins] Failed to save persisted plugin state:', error);
  }
}

function validateStringField(
  manifest: Record<string, unknown>,
  key: string,
  pluginDir: string,
  required = false,
): string | undefined {
  const value = manifest[key];

  if (value === undefined) {
    if (required) {
      throw new Error(`Missing required field '${key}' in ${pluginDir}`);
    }
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected '${key}' to be a non-empty string in ${pluginDir}`);
  }

  return value;
}

function validateEnumArray<T extends string>(
  value: unknown,
  key: string,
  allowedValues: readonly T[],
  pluginDir: string,
): T[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Expected '${key}' to be an array of strings in ${pluginDir}`);
  }

  const invalidValue = value.find((item): item is string => !allowedValues.includes(item as T));
  if (invalidValue) {
    throw new Error(`Invalid '${key}' value '${invalidValue}' in ${pluginDir}`);
  }

  return [...new Set(value as T[])];
}

export function validateManifest(raw: unknown, pluginDir: string): PluginManifest {
  if (!isPlainObject(raw)) {
    throw new Error(`Expected manifest object in ${pluginDir}`);
  }

  const id = validateStringField(raw, 'id', pluginDir, true)!;
  const name = validateStringField(raw, 'name', pluginDir, true)!;
  const version = validateStringField(raw, 'version', pluginDir, true)!;
  const apiVersion = validateStringField(raw, 'apiVersion', pluginDir, true)!;

  if (apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `Unsupported plugin apiVersion '${apiVersion}' in ${pluginDir}; expected '${PLUGIN_API_VERSION}'`,
    );
  }

  const capabilities = validateEnumArray(raw.capabilities, 'capabilities', VALID_CAPABILITIES, pluginDir);
  const permissions = validateEnumArray(raw.permissions, 'permissions', VALID_PERMISSIONS, pluginDir);
  const description = validateStringField(raw, 'description', pluginDir);
  const author = validateStringField(raw, 'author', pluginDir);
  const main = validateStringField(raw, 'main', pluginDir);
  const languageId = validateStringField(raw, 'languageId', pluginDir);
  const pythonModuleDir = validateStringField(raw, 'pythonModuleDir', pluginDir);
  const pythonModuleName = validateStringField(raw, 'pythonModuleName', pluginDir);

  const manifest: PluginManifest = {
    id,
    name,
    version,
    apiVersion,
    capabilities,
    permissions,
  };

  if (description) {
    manifest.description = description;
  }
  if (author) {
    manifest.author = author;
  }
  if (main) {
    manifest.main = main;
  }
  if (languageId) {
    manifest.languageId = languageId;
  }
  if (pythonModuleDir) {
    manifest.pythonModuleDir = pythonModuleDir;
  }
  if (pythonModuleName) {
    manifest.pythonModuleName = pythonModuleName;
  }

  if (raw.ui !== undefined) {
    if (!isPlainObject(raw.ui) || typeof raw.ui.type !== 'string') {
      throw new Error(`Invalid 'ui' contribution in ${pluginDir}`);
    }
    manifest.ui = raw.ui as unknown as PluginManifest['ui'];
  }

  return manifest;
}

export function isSafePath(base: string, target: string): boolean {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);

  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

export function activatePlugin(entry: PluginEntry): void {
  const mainRelativePath = entry.manifest.main ?? DEFAULT_PLUGIN_MAIN;
  const mainPath = path.resolve(entry.pluginPath, mainRelativePath);

  entry.state.errorMessage = undefined;

  if (!isSafePath(entry.pluginPath, mainPath)) {
    entry.state.status = 'error';
    entry.state.errorMessage = 'Plugin main entry must stay within the plugin directory';
    return;
  }

  try {
    if (!fs.existsSync(mainPath)) {
      entry.moduleExports = undefined;
      entry.state.status = 'active';
      return;
    }

    const loadedModule = require(mainPath) as Record<string, unknown>;
    entry.moduleExports = loadedModule;

    const activate = loadedModule.activate;
    if (typeof activate === 'function') {
      activate();
    }

    entry.state.status = 'active';
  } catch (error) {
    entry.moduleExports = undefined;
    entry.state.status = 'error';
    entry.state.errorMessage = error instanceof Error ? error.message : String(error);
  }
}

export function discoverPlugins(): void {
  const pluginsDir = getPluginsDir();
  const persistedState = loadPersistedState();
  const disabledPlugins = new Set(persistedState.disabled);
  const permissionsGranted = new Set(persistedState.permissionsGranted);

  registry.clear();
  fs.mkdirSync(pluginsDir, { recursive: true });

  const pluginDirectories = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const directory of pluginDirectories) {
    const pluginDir = path.join(pluginsDir, directory.name);
    const manifestPath = path.join(pluginDir, MANIFEST_FILE_NAME);

    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    try {
      const rawManifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const manifest = validateManifest(rawManifest, pluginDir);

      if (registry.has(manifest.id)) {
        console.warn(`[plugins] Duplicate plugin id '${manifest.id}' in ${pluginDir}; skipping`);
        continue;
      }

      const entry: PluginEntry = {
        manifest,
        pluginPath: pluginDir,
        state: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          capabilities: [...manifest.capabilities],
          permissions: [...manifest.permissions],
          status: disabledPlugins.has(manifest.id) ? 'disabled' : 'pending',
          pluginPath: pluginDir,
          permissionsGranted: permissionsGranted.has(manifest.id),
        },
      };

      registry.set(manifest.id, entry);
    } catch (error) {
      console.error(`[plugins] Failed to discover plugin at ${pluginDir}:`, error);
    }
  }
}

function saveDisabledState(id: string, disabled: boolean): void {
  const persistedState = loadPersistedState();
  const disabledPlugins = new Set(persistedState.disabled);

  if (disabled) {
    disabledPlugins.add(id);
  } else {
    disabledPlugins.delete(id);
  }

  savePersistedState({
    disabled: [...disabledPlugins],
    permissionsGranted: persistedState.permissionsGranted,
  });
}

function clonePluginState(state: PluginState): PluginState {
  return {
    ...state,
    capabilities: [...state.capabilities],
    permissions: [...state.permissions],
  };
}

export function initPluginManager(): void {
  discoverPlugins();

  const entries = [...registry.values()].sort((a, b) => a.state.id.localeCompare(b.state.id));
  for (const entry of entries) {
    activateIfPermitted(entry);
  }

  console.log(`[plugins] Plugin manager initialized with ${registry.size} plugin(s)`);
}

export function listPlugins(): PluginState[] {
  return [...registry.values()].map((entry) => clonePluginState(entry.state));
}

export function enablePlugin(id: string): PluginState | null {
  const entry = registry.get(id);
  if (!entry) {
    return null;
  }

  saveDisabledState(id, false);
  entry.state.status = 'pending';
  activateIfPermitted(entry);
  return clonePluginState(entry.state);
}

export function disablePlugin(id: string): PluginState | null {
  const entry = registry.get(id);
  if (!entry) {
    return null;
  }

  saveDisabledState(id, true);
  entry.moduleExports = undefined;
  entry.state.status = 'disabled';
  entry.state.errorMessage = undefined;
  return clonePluginState(entry.state);
}

export function grantPermissions(id: string): PluginState | null {
  const entry = registry.get(id);
  if (!entry) {
    return null;
  }

  const persistedState = loadPersistedState();
  const permissionsGranted = new Set(persistedState.permissionsGranted);
  permissionsGranted.add(id);

  savePersistedState({
    disabled: persistedState.disabled,
    permissionsGranted: [...permissionsGranted],
  });

  entry.state.permissionsGranted = true;
  activateIfPermitted(entry);
  return clonePluginState(entry.state);
}

export function removePluginFromRegistry(id: string): boolean {
  const existed = registry.delete(id);
  if (!existed) {
    return false;
  }

  const persistedState = loadPersistedState();
  savePersistedState({
    disabled: persistedState.disabled.filter((pluginId) => pluginId !== id),
    permissionsGranted: persistedState.permissionsGranted.filter((pluginId) => pluginId !== id),
  });

  return true;
}

export function registerInstalledPlugin(manifest: PluginManifest, pluginPath: string): PluginState {
  const validatedManifest = validateManifest(manifest, pluginPath);
  const persistedState = loadPersistedState();
  const entry: PluginEntry = {
    manifest: validatedManifest,
    pluginPath,
    state: {
      id: validatedManifest.id,
      name: validatedManifest.name,
      version: validatedManifest.version,
      description: validatedManifest.description,
      author: validatedManifest.author,
      capabilities: [...validatedManifest.capabilities],
      permissions: [...validatedManifest.permissions],
      status: persistedState.disabled.includes(validatedManifest.id) ? 'disabled' : 'pending',
      pluginPath,
      permissionsGranted: persistedState.permissionsGranted.includes(validatedManifest.id),
    },
  };

  registry.set(validatedManifest.id, entry);

  activateIfPermitted(entry);

  return clonePluginState(entry.state);
}

export function getPluginManifest(id: string): PluginManifest | null {
  return registry.get(id)?.manifest ?? null;
}
