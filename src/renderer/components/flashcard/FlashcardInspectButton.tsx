import { Component } from 'solid-js';
import { Button } from '../common/Button';
import { useLocalization } from '../../context';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';

export const FlashcardInspectButton: Component<{ language: string; surface: string }> = props => {
  const { t } = useLocalization();
  return <Button variant="ghost" size="xs" onClick={event => {
    event.stopPropagation();
    openKnowledgeInspector(surfaceKnowledgeInspection(props.language, props.surface));
  }}>{t('mlearn.Knowledge.Popup.Inspect')}</Button>;
};
