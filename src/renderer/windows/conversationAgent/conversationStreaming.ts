import type { ConversationMessage } from '../../../shared/types';

export type ConversationOverlay = ConversationMessage & {
  displayName?: string;
  actorId?: string;
  beats?: string[];
  recovery?: 'settings';
};

export function streamingMessages(overlay: ConversationOverlay | null): ConversationOverlay[] {
  if (!overlay) return [];
  if (!overlay.beats || overlay.beats.length < 2) return [overlay];
  return overlay.beats.map((content, index) => ({
    ...overlay, content, tokens: undefined,
    widgets: index === overlay.beats!.length - 1 ? overlay.widgets : undefined,
    widget: index === overlay.beats!.length - 1 ? overlay.widget : undefined,
  }));
}
