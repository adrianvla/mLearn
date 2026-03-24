/**
 * AgentSetupModal
 * Multi-step wizard for setting up a conversation agent.
 * Create mode: personality → (roleplay-method) → details
 * Edit mode: details only
 */

import { Component, createSignal, createEffect, Show, For, Switch, Match } from 'solid-js';
import { useLocalization } from '../../context';
import {
  ModalForm,
  Input,
  Textarea,
  Btn,
  Select,
  HintText,
  FormField,
  VoiceSamplePicker,
} from '../../components/common';
import type { AgentConfig, AgentPersonality, RoleplayFormality } from '../../../shared/types';
import { isElectron } from '../../../shared/platform';
import { RoleplayQuickStart } from './RoleplayQuickStart';
import './AgentSetupModal.css';

interface AgentSetupModalProps {
  isOpen: boolean;
  onComplete: (config: AgentConfig) => void;
  onClose?: () => void;
  /** When set, the modal is in edit mode and prefills from this config */
  initialConfig?: AgentConfig | null;
}

const MAX_PHOTO_SIZE = 256;

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        canvas.width = MAX_PHOTO_SIZE;
        canvas.height = MAX_PHOTO_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, sx, sy, size, size, 0, 0, MAX_PHOTO_SIZE, MAX_PHOTO_SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type WizardStep = 'personality' | 'roleplay-method' | 'details';

export const AgentSetupModal: Component<AgentSetupModalProps> = (props) => {
  const { t } = useLocalization();

  const isEditMode = () => !!props.initialConfig;

  const [wizardStep, setWizardStep] = createSignal<WizardStep>('personality');
  const [agentName, setAgentName] = createSignal('');
  const [userName, setUserName] = createSignal('');
  const [personality, setPersonality] = createSignal<AgentPersonality>('casual');
  const [roleplayName, setRoleplayName] = createSignal('');
  const [roleplayLore, setRoleplayLore] = createSignal('');
  const [roleplayFormality, setRoleplayFormality] = createSignal<RoleplayFormality>('casual');
  const [voiceSampleId, setVoiceSampleId] = createSignal('');
  const [profilePhoto, setProfilePhoto] = createSignal('');
  const [aboutMe, setAboutMe] = createSignal('');
  const [roleplayQuotes, setRoleplayQuotes] = createSignal<string[]>([]);
  const [roleplayFandomUrl, setRoleplayFandomUrl] = createSignal('');
  const [roleplayContext, setRoleplayContext] = createSignal('');
  const [showQuickStart, setShowQuickStart] = createSignal(false);

  let fileInputRef: HTMLInputElement | undefined;

  // Prefill fields when initialConfig changes (edit mode) or reset on create
  createEffect(() => {
    const cfg = props.initialConfig;
    if (cfg) {
      setWizardStep('details');
      setAgentName(cfg.agentName || '');
      setUserName(cfg.userName || '');
      setPersonality(cfg.personality || 'casual');
      setRoleplayName(cfg.roleplayName || '');
      setRoleplayLore(cfg.roleplayLore || '');
      setRoleplayFormality(cfg.roleplayFormality || 'casual');
      setVoiceSampleId(cfg.voiceSampleId || '');
      setProfilePhoto(cfg.profilePhoto || '');
      setAboutMe(cfg.aboutMe || '');
      setRoleplayQuotes(cfg.roleplayQuotes || []);
      setRoleplayFandomUrl(cfg.roleplayFandomUrl || '');
      setRoleplayContext(cfg.roleplayContext || '');
    } else if (props.isOpen) {
      setWizardStep('personality');
      setAgentName('');
      setUserName('');
      setPersonality('casual');
      setRoleplayName('');
      setRoleplayLore('');
      setRoleplayFormality('casual');
      setVoiceSampleId('');
      setProfilePhoto('');
      setAboutMe('');
      setRoleplayQuotes([]);
      setRoleplayFandomUrl('');
      setRoleplayContext('');
    }
  });

  const formalityOptions = () => [
    { value: 'polite', label: t('mlearn.ConversationAgent.Personality.Polite') },
    { value: 'casual', label: t('mlearn.ConversationAgent.Personality.Casual') },
  ];

  const handlePhotoUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const dataUri = await resizeImage(file);
    setProfilePhoto(dataUri);
    input.value = '';
  };

  const handleStart = () => {
    const quotes = roleplayQuotes().filter((q) => q.trim());
    const config: AgentConfig = {
      id: props.initialConfig?.id || '',
      agentName: agentName().trim(),
      userName: userName().trim(),
      personality: personality(),
      roleplayName: personality() === 'roleplay' ? roleplayName().trim() : '',
      roleplayLore: personality() === 'roleplay' ? roleplayLore().trim() : '',
      roleplayFormality: personality() === 'roleplay' ? roleplayFormality() : undefined,
      voiceSampleId: voiceSampleId() || undefined,
      profilePhoto: profilePhoto() || undefined,
      aboutMe: aboutMe().trim() || undefined,
      roleplayQuotes: personality() === 'roleplay' && quotes.length > 0 ? quotes : undefined,
      roleplayFandomUrl: personality() === 'roleplay' && roleplayFandomUrl().trim() ? roleplayFandomUrl().trim() : undefined,
      roleplayContext: personality() === 'roleplay' && roleplayContext().trim() ? roleplayContext().trim() : undefined,
      setupComplete: true,
    };
    props.onComplete(config);
  };

  const selectPersonality = (p: AgentPersonality) => {
    setPersonality(p);
    if (p === 'roleplay') {
      setWizardStep('roleplay-method');
    } else {
      setWizardStep('details');
    }
  };

  const goBackFromDetails = () => {
    if (personality() === 'roleplay') {
      setWizardStep('roleplay-method');
    } else {
      setWizardStep('personality');
    }
  };

  const addQuote = () => {
    const current = roleplayQuotes();
    if (current.length < 4) {
      setRoleplayQuotes([...current, '']);
    }
  };

  const removeQuote = (index: number) => {
    setRoleplayQuotes(roleplayQuotes().filter((_, i) => i !== index));
  };

  const updateQuote = (index: number, value: string) => {
    const updated = [...roleplayQuotes()];
    updated[index] = value;
    setRoleplayQuotes(updated);
  };

  const handleQuickStartComplete = (config: Partial<AgentConfig>) => {
    if (config.roleplayName) setRoleplayName(config.roleplayName);
    if (config.roleplayLore) setRoleplayLore(config.roleplayLore);
    if (config.roleplayQuotes) setRoleplayQuotes(config.roleplayQuotes);
    if (config.roleplayFandomUrl) setRoleplayFandomUrl(config.roleplayFandomUrl);
    if (config.roleplayContext) setRoleplayContext(config.roleplayContext);
    if (config.agentName) setAgentName(config.agentName);
    setPersonality('roleplay');
    setShowQuickStart(false);
    setWizardStep('details');
  };

  const detailsFooter = (
    <div class="agent-setup-actions">
      <Show when={!isEditMode()}>
        <Btn variant="ghost" onClick={goBackFromDetails}>
          {t('mlearn.ConversationAgent.QuickStart.Back')}
        </Btn>
      </Show>
      <Btn variant="ghost" onClick={() => props.onClose?.()}>
        {t('mlearn.ConversationAgent.Setup.Cancel')}
      </Btn>
      <Btn variant="primary" onClick={handleStart}>
        {isEditMode() ? t('mlearn.ConversationAgent.Agents.Save') : t('mlearn.ConversationAgent.Setup.Start')}
      </Btn>
    </div>
  );

  return (
    <ModalForm
      isOpen={props.isOpen}
      onClose={() => props.onClose?.()}
      title={isEditMode() ? t('mlearn.ConversationAgent.Agents.EditTitle') : t('mlearn.ConversationAgent.Setup.Title')}
      size="lg"
      showCloseButton={true}
      closeOnOverlay={isEditMode()}
      closeOnEscape={true}
      footer={wizardStep() === 'details' ? detailsFooter : undefined}
      headerDraggable={true}
      onSubmit={wizardStep() === 'details' ? handleStart : undefined}
    >
      <Switch>
        {/* Step 1: Choose personality type */}
        <Match when={wizardStep() === 'personality'}>
          <div class="agent-setup-personality-step">
            <HintText>{t('mlearn.ConversationAgent.Setup.PersonalityLabel')}</HintText>
            <div class="agent-setup-personality-cards">
              <button
                class="agent-setup-personality-card"
                onClick={() => selectPersonality('casual')}
              >
                <span class="agent-setup-personality-card-title">
                  {t('mlearn.ConversationAgent.Personality.Casual')}
                </span>
                <span class="agent-setup-personality-card-desc">
                  {t('mlearn.ConversationAgent.Personality.CasualDescription')}
                </span>
              </button>
              <button
                class="agent-setup-personality-card"
                onClick={() => selectPersonality('polite')}
              >
                <span class="agent-setup-personality-card-title">
                  {t('mlearn.ConversationAgent.Personality.Polite')}
                </span>
                <span class="agent-setup-personality-card-desc">
                  {t('mlearn.ConversationAgent.Personality.PoliteDescription')}
                </span>
              </button>
              <button
                class="agent-setup-personality-card"
                onClick={() => selectPersonality('roleplay')}
              >
                <span class="agent-setup-personality-card-title">
                  {t('mlearn.ConversationAgent.Personality.Roleplay')}
                </span>
                <span class="agent-setup-personality-card-desc">
                  {t('mlearn.ConversationAgent.Personality.RoleplayDescription')}
                </span>
              </button>
            </div>
          </div>
        </Match>

        {/* Step 2: Roleplay method — Quick Start or Manual */}
        <Match when={wizardStep() === 'roleplay-method'}>
          <div class="agent-setup-roleplay-method">
            <div class="agent-setup-personality-cards">
              <button
                class="agent-setup-personality-card"
                onClick={() => setShowQuickStart(true)}
              >
                <span class="agent-setup-personality-card-title">
                  {t('mlearn.ConversationAgent.QuickStart.Button')}
                </span>
                <span class="agent-setup-personality-card-desc">
                  {t('mlearn.ConversationAgent.QuickStart.Hint')}
                </span>
              </button>
              <button
                class="agent-setup-personality-card"
                onClick={() => setWizardStep('details')}
              >
                <span class="agent-setup-personality-card-title">
                  {t('mlearn.ConversationAgent.Setup.ManualSetup')}
                </span>
                <span class="agent-setup-personality-card-desc">
                  {t('mlearn.ConversationAgent.Setup.ManualSetupHint')}
                </span>
              </button>
            </div>
            <div class="agent-setup-actions">
              <Btn variant="ghost" onClick={() => setWizardStep('personality')}>
                {t('mlearn.ConversationAgent.QuickStart.Back')}
              </Btn>
            </div>
          </div>
        </Match>

        {/* Step 3: Details form */}
        <Match when={wizardStep() === 'details'}>
          <div class="agent-setup-form">
            {/* Profile photo */}
            <div class="agent-setup-photo-section">
              <div
                class="agent-setup-photo-preview"
                onClick={() => fileInputRef?.click()}
              >
                <Show
                  when={profilePhoto()}
                  fallback={
                    <div class="agent-setup-photo-empty">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" />
                        <path d="M20 21v-2c0-2.21-3.58-4-8-4s-8 1.79-8 4v2" />
                      </svg>
                    </div>
                  }
                >
                  <img class="agent-setup-photo-img" src={profilePhoto()} alt="" />
                </Show>
              </div>
              <div class="agent-setup-photo-controls">
                <Btn size="sm" variant="ghost" onClick={() => fileInputRef?.click()}>
                  {t('mlearn.ConversationAgent.Setup.ProfilePhoto')}
                </Btn>
                <Show when={profilePhoto()}>
                  <Btn size="sm" variant="ghost" onClick={() => setProfilePhoto('')}>
                    {t('mlearn.ConversationAgent.Setup.ProfilePhotoRemove')}
                  </Btn>
                </Show>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                class="agent-setup-photo-input"
                onChange={handlePhotoUpload}
              />
            </div>

            <FormField label={t('mlearn.ConversationAgent.Setup.UserNameLabel')}>
              <Input
                value={userName()}
                onInput={(e) => setUserName(e.currentTarget.value)}
                placeholder={t('mlearn.ConversationAgent.Setup.UserNamePlaceholder')}
                size="md"
              />
            </FormField>

            <FormField label={t('mlearn.ConversationAgent.Setup.NameLabel')}>
              <Input
                value={agentName()}
                onInput={(e) => setAgentName(e.currentTarget.value)}
                placeholder={t('mlearn.ConversationAgent.Setup.NamePlaceholder')}
                size="md"
              />
            </FormField>

            {/* In edit mode, show personality selector since we skip step 1 */}
            <Show when={isEditMode()}>
              <FormField label={t('mlearn.ConversationAgent.Setup.PersonalityLabel')}>
                <Select
                  options={[
                    { value: 'polite', label: t('mlearn.ConversationAgent.Personality.Polite') },
                    { value: 'casual', label: t('mlearn.ConversationAgent.Personality.Casual') },
                    { value: 'roleplay', label: t('mlearn.ConversationAgent.Personality.Roleplay') },
                  ]}
                  value={personality()}
                  onChange={(e) => setPersonality(e.currentTarget.value as AgentPersonality)}
                />
              </FormField>
            </Show>

            <Show when={personality() === 'roleplay'}>
              <FormField label={t('mlearn.ConversationAgent.Personality.RoleplayFormality')}>
                <Select
                  options={formalityOptions()}
                  value={roleplayFormality()}
                  onChange={(e) => setRoleplayFormality(e.currentTarget.value as RoleplayFormality)}
                />
              </FormField>

              <FormField label={t('mlearn.ConversationAgent.Personality.RoleplayName')}>
                <Input
                  value={roleplayName()}
                  onInput={(e) => setRoleplayName(e.currentTarget.value)}
                  placeholder={t('mlearn.ConversationAgent.Personality.RoleplayNamePlaceholder')}
                  size="md"
                />
              </FormField>

              <FormField label={t('mlearn.ConversationAgent.Personality.RoleplayLore')}>
                <Textarea
                  value={roleplayLore()}
                  onInput={(e) => setRoleplayLore(e.currentTarget.value)}
                  placeholder={t('mlearn.ConversationAgent.Personality.RoleplayLorePlaceholder')}
                  rows={3}
                  resize="vertical"
                />
              </FormField>

              <Show when={roleplayContext()}>
                <FormField label={t('mlearn.ConversationAgent.Personality.RoleplayBackstory')}>
                  <Textarea
                    value={roleplayContext()}
                    onInput={(e) => setRoleplayContext(e.currentTarget.value)}
                    placeholder={t('mlearn.ConversationAgent.Personality.RoleplayBackstoryPlaceholder')}
                    rows={4}
                    resize="vertical"
                  />
                </FormField>
              </Show>

              <FormField
                label={t('mlearn.ConversationAgent.Personality.RoleplayQuotes')}
                hint={t('mlearn.ConversationAgent.Personality.RoleplayQuotesHint')}
              >
                <div class="agent-setup-quotes">
                  <For each={roleplayQuotes()}>
                    {(quote, index) => (
                      <div class="agent-setup-quote-row">
                        <Input
                          value={quote}
                          onInput={(e) => updateQuote(index(), e.currentTarget.value)}
                          placeholder={t('mlearn.ConversationAgent.Personality.RoleplayQuotePlaceholder')}
                          size="md"
                        />
                        <Btn size="sm" variant="ghost" onClick={() => removeQuote(index())}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </Btn>
                      </div>
                    )}
                  </For>
                  <Show when={roleplayQuotes().length < 4}>
                    <Btn size="sm" variant="ghost" onClick={addQuote}>
                      {t('mlearn.ConversationAgent.Personality.AddQuote')}
                    </Btn>
                  </Show>
                </div>
              </FormField>

              <FormField
                label={t('mlearn.ConversationAgent.Personality.FandomUrl')}
                hint={t('mlearn.ConversationAgent.Personality.FandomUrlHint')}
              >
                <Input
                  value={roleplayFandomUrl()}
                  onInput={(e) => setRoleplayFandomUrl(e.currentTarget.value)}
                  placeholder={t('mlearn.ConversationAgent.Personality.FandomUrlPlaceholder')}
                  size="md"
                />
              </FormField>
            </Show>

            {/* Voice sample picker — only on Electron */}
            <Show when={isElectron()}>
              <FormField label={t('mlearn.ConversationAgent.Setup.VoiceSample')}>
                <VoiceSamplePicker
                  value={voiceSampleId()}
                  onChange={setVoiceSampleId}
                />
              </FormField>
            </Show>

            <FormField
              label={t('mlearn.ConversationAgent.Setup.AboutMeLabel')}
              hint={t('mlearn.ConversationAgent.Setup.AboutMeHint')}
            >
              <Textarea
                value={aboutMe()}
                onInput={(e) => setAboutMe(e.currentTarget.value)}
                placeholder={t('mlearn.ConversationAgent.Setup.AboutMePlaceholder')}
                rows={3}
                resize="vertical"
              />
            </FormField>


          </div>
        </Match>
      </Switch>
      <RoleplayQuickStart
        isOpen={showQuickStart()}
        onClose={() => setShowQuickStart(false)}
        onComplete={handleQuickStartComplete}
      />
    </ModalForm>
  );
};
