/**
 * Plugin system shared types.
 *
 * Used by main process, renderer, and bridge layers.
 */

// Manifest
export type PluginCapability =
  | 'language'
  | 'ui-panel'
  | 'integration';

export type PluginPermission =
  | 'kv-store'
  | 'open-window'
  | 'http';

export interface PluginUIContributionSchema {
  type: 'schema';
  schema: Record<string, unknown>;
  initialData?: Record<string, unknown>;
}

export interface PluginUIContributionComponent {
  type: 'component';
  componentPath: string;
  componentUrl?: string;
}

export type PluginUIContribution =
  | PluginUIContributionSchema
  | PluginUIContributionComponent;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  author?: string;
  main?: string;
  languageId?: string;
  pythonModuleDir?: string;
  pythonModuleName?: string;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  ui?: PluginUIContribution;
}

export type PluginStatus =
  | 'disabled'
  | 'active'
  | 'error'
  | 'pending';

export interface PluginState {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  status: PluginStatus;
  errorMessage?: string;
  pluginPath: string;
  permissionsGranted: boolean;
  ui?: PluginUIContribution;
}

export interface PluginInstallResult {
  success: boolean;
  pluginId?: string;
  error?: string;
}

export interface PluginKVGetResult {
  value: string | null;
}

export interface PluginWindowPayload {
  pluginId: string;
  context?: Record<string, unknown>;
}

export interface PluginHostContext {
  pluginId: string;
  pluginName: string;
  ui: PluginUIContribution;
  initialContext?: Record<string, unknown>;
}
