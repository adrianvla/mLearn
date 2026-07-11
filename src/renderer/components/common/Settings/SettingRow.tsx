/**
 * Setting Row Component
 * A consistent row layout for settings with label, description, and control
 * Used extensively across all settings tabs
 */

import { ParentComponent, Show, JSX, createEffect, onCleanup } from 'solid-js';
import { useLocalization, useOptionalSettings, useSettingsSearch, useSettingsTab } from '../../../context';
import type { PolicySettingKey } from '../../../../shared/managementPolicy';
import { ManagedSettingNotice } from '../ManagedSettingNotice';
import './SettingRow.css';

let rowCounter = 0;

export interface SettingRowProps {
  label: string;
  description?: string;
  disabled?: boolean;
  requiresRestart?: boolean;
  icon?: string;
  class?: string;
  style?: JSX.CSSProperties;
  settingKey?: PolicySettingKey;
  /** Mutation control to lock separately from recovery/help children. */
  managedControl?: JSX.Element;
}

export const SettingRow: ParentComponent<SettingRowProps> = (props) => {
  const { t } = useLocalization();
  const searchCtx = useSettingsSearch();
  const tabCtx = useSettingsTab();
  const settingsCtx = useOptionalSettings();
  const rowId = `sr-${++rowCounter}`;
  const query = () => searchCtx?.searchQuery()?.toLowerCase().trim() ?? '';
  const matches = () => {
    const q = query();
    if (!q) return true;
    const text = `${props.label} ${props.description ?? ''}`.toLowerCase();
    return text.includes(q);
  };
  const managedSource = () => props.settingKey
    ? settingsCtx?.getManagedSettingSource(props.settingKey)
    : null;
  const disabled = () => Boolean(props.disabled || managedSource());
  const managed = () => Boolean(managedSource());

  createEffect(() => {
    const tabId = tabCtx?.tabId;
    if (tabId && searchCtx) {
      searchCtx.registerMatch(tabId, rowId, matches());
      onCleanup(() => searchCtx.registerMatch(tabId, rowId, false));
    }
  });

  return (
    <Show when={matches()}>
      <div
        class={`setting-row ${props.disabled ? 'disabled' : ''} ${managed() ? 'managed' : ''} ${props.class || ''}`}
        style={props.style}
      >
      <div class="setting-info">
        <span class="setting-label">
          <Show when={props.icon}>
            <span class="setting-icon">{props.icon}</span>
          </Show>
          {props.label}
          <Show when={props.requiresRestart}>
            <span class="restart-indicator" title={t('mlearn.Global.RequiresRestart')}>⟳</span>
          </Show>
        </span>
        <Show when={props.description}>
          <span class="setting-description">{props.description}</span>
        </Show>
        <Show when={managedSource()}>
          {(source) => <ManagedSettingNotice sourceGroupName={source().sourceGroupName} />}
        </Show>
      </div>
      <div class="setting-control">
        <Show when={props.managedControl} fallback={(
          <Show when={disabled()} fallback={props.children}>
            <fieldset class="managed-setting-control" disabled>
              {props.children}
            </fieldset>
          </Show>
        )}>
          {(control) => (
            <>
              <Show when={disabled()} fallback={control()}>
                <fieldset class="managed-setting-control" disabled>{control()}</fieldset>
              </Show>
              {props.children}
            </>
          )}
        </Show>
      </div>
    </div>
    </Show>
  );
};

export default SettingRow;
