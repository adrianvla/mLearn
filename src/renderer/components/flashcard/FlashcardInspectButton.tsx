import { Component } from 'solid-js';
import { Btn } from '../common/Button';
import { useLocalization } from '../../context';
import { surfaceEntityId } from '../../../shared/graph/load';
import { hashWordSync } from '../../services/srsAlgorithm';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';

export const FlashcardInspectButton: Component<{ language: string; surface: string }> = props => {
  const { t } = useLocalization();
  return <Btn variant="ghost" size="xs" onClick={event => {
    event.stopPropagation();
    openKnowledgeInspector({ language: props.language, surface: props.surface,
      target: { kind: 'surface', id: surfaceEntityId(props.language, hashWordSync(props.surface)) } });
  }}>{t('mlearn.Knowledge.Popup.Inspect')}</Btn>;
};
