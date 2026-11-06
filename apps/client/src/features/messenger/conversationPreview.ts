import type { ConversationPreview } from '@mlearn/contracts';

export function conversationPreviewText(preview: ConversationPreview): string {
  switch (preview.status) {
    case 'complete':
      return preview.text;
    case 'pending':
    case 'partial':
    case 'failed':
    case 'cancelled':
    case 'interrupted':
    case 'invalidated':
    case 'deleted':
      return `${preview.status}${preview.text ? ` \u00b7 ${preview.text}` : ''}`;
  }
}
