import { Component, For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Btn, Modal } from '../common';
import { useLocalization } from '../../context/LocalizationContext';
import { useSettings } from '../../context/SettingsContext';
import {
  activateGroup,
  ensureActiveGroup,
  requiresManagementGroup,
  type ManagementGroup,
} from '../../services/managementGroupService';
import './ActiveGroupSelector.css';

export interface ActiveGroupSelectorProps {
  groups: readonly ManagementGroup[];
  activeGroupId: string;
  onActivate: (group: ManagementGroup) => Promise<unknown> | unknown;
}

export const ActiveGroupSelector: Component<ActiveGroupSelectorProps> = (props) => {
  const { t } = useLocalization();
  const [isOpen, setIsOpen] = createSignal(false);
  const [pendingGroupId, setPendingGroupId] = createSignal('');
  const [error, setError] = createSignal('');
  const requiresSelection = () => props.groups.length > 1 && !props.activeGroupId;
  const activeGroup = () => props.groups.find((group) => group.id === props.activeGroupId);

  createEffect(() => {
    if (requiresSelection()) setIsOpen(true);
  });

  const close = () => {
    if (!requiresSelection() && !pendingGroupId()) setIsOpen(false);
  };

  const activate = async (group: ManagementGroup) => {
    if (pendingGroupId()) return;
    setPendingGroupId(group.id);
    setError('');
    try {
      await props.onActivate(group);
      setIsOpen(false);
    } catch {
      setError(t('mlearn.Management.GroupActivationError'));
    } finally {
      setPendingGroupId('');
    }
  };

  return (
    <Show when={props.groups.length > 1}>
      <Show when={activeGroup()}>
        {(group) => (
          <Btn
            class="active-group-trigger"
            variant="secondary"
            size="sm"
            aria-label={`${t('mlearn.Management.ActiveGroup')}: ${group().name}`}
            onClick={() => {
              setError('');
              setIsOpen(true);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="8" cy="8" r="3" />
              <path d="M3 19c.4-3 2.1-5 5-5s4.6 2 5 5" />
              <path d="M14 8h7M18 4l3 4-3 4" />
            </svg>
            <span>{group().name}</span>
          </Btn>
        )}
      </Show>

      <Modal
        isOpen={isOpen()}
        onClose={close}
        title={t('mlearn.Management.ChooseGroup')}
        subtitle={t('mlearn.Management.ChooseGroupDescription')}
        size="sm"
        closeOnEscape={!requiresSelection()}
        closeOnOverlay={!requiresSelection()}
        showCloseButton={!requiresSelection()}
        panelClass="active-group-modal"
      >
        <div
          class="active-group-selector"
          role="dialog"
          aria-label={t('mlearn.Management.ChooseGroup')}
          aria-modal="true"
        >
          <div class="active-group-list">
            <For each={props.groups}>
              {(group) => (
                <button
                  type="button"
                  class="active-group-option"
                  classList={{ selected: group.id === props.activeGroupId }}
                  data-group-id={group.id}
                  disabled={Boolean(pendingGroupId())}
                  aria-current={group.id === props.activeGroupId ? 'true' : undefined}
                  onClick={() => void activate(group)}
                >
                  <span class="active-group-option-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="9" cy="8" r="3" />
                      <path d="M4 19c.5-3.2 2.2-5 5-5s4.5 1.8 5 5" />
                      <path d="M16 9h4M18 7v4" />
                    </svg>
                  </span>
                  <span class="active-group-option-name">{group.name}</span>
                  <Show when={pendingGroupId() === group.id}>
                    <span class="active-group-option-status">{t('mlearn.Management.ActivatingGroup')}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <Show when={error()}>
            <p class="active-group-error" role="alert">{error()}</p>
          </Show>
        </div>
      </Modal>
    </Show>
  );
};

export const ActiveGroupGate: Component = () => {
  const { settings, updateSettings, isLoading } = useSettings();
  const { t } = useLocalization();
  const [groups, setGroups] = createSignal<ManagementGroup[]>([]);
  const [loadError, setLoadError] = createSignal('');
  const [reloadGeneration, setReloadGeneration] = createSignal(0);
  let requestGeneration = 0;

  createEffect(() => {
    const generation = ++requestGeneration;
    const loading = isLoading();
    const signedIn = settings.cloudAuthStatus === 'signed-in';
    const managed = requiresManagementGroup(settings);
    const activeGroupId = settings.cloudAuthActiveGroupId;
    const endpoint = settings.cloudApiUrl;
    const accessToken = settings.cloudAuthAccessToken;
    reloadGeneration();

    if (loading || !signedIn || !managed) {
      setGroups([]);
      setLoadError('');
      return;
    }

    setLoadError('');
    void ensureActiveGroup(settings, updateSettings, accessToken)
      .then((result) => {
        if (generation !== requestGeneration) return;
        setGroups(result.groups);
      })
      .catch(() => {
        if (generation !== requestGeneration) return;
        setGroups([]);
        setLoadError(t('mlearn.Management.GroupLoadError'));
      });

    // These reads define the scope that invalidates an in-flight request.
    void activeGroupId;
    void endpoint;
  });

  onCleanup(() => {
    requestGeneration += 1;
  });

  const handleActivate = async (group: ManagementGroup) => {
    await activateGroup(settings, group, updateSettings, undefined, groups());
  };

  return (
    <>
      <ActiveGroupSelector
        groups={groups()}
        activeGroupId={settings.cloudAuthActiveGroupId}
        onActivate={handleActivate}
      />
      <Show when={loadError()}>
        <div class="active-group-load-error" role="alert">
          <span>{loadError()}</span>
          <Btn size="sm" variant="secondary" onClick={() => setReloadGeneration((value) => value + 1)}>
            {t('mlearn.Management.Retry')}
          </Btn>
        </div>
      </Show>
    </>
  );
};

export default ActiveGroupSelector;
