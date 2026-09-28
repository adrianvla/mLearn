import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/windows/conversationAgent/ConversationAgent.css', 'utf8');

/** Body of the rule whose selector starts a line and matches exactly. */
const ruleOf = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

// The voice overlay and (drawer-layout) history sidebar are
// painted on top of chat content. --bg / --bg-primary are translucent in every
// theme and the high-contrast themes disable backdrop filters entirely, so a
// translucent surface here lets chat bleed through unblurred. Overlapping
// surfaces must use an opaque token (--bg-nt-*, --bg-opaque).
describe('conversation agent overlapping surfaces', () => {
  it.each(['.ca-voice-overlay', '.ca-history-sidebar', '.ca-chat-content'])(
    '%s paints an opaque surface, not a translucent alias',
    (selector) => {
      const body = ruleOf(selector);
      expect(body).not.toBe('');
      expect(body).toMatch(/background:\s*var\(--bg-(nt-|opaque)/);
      expect(body).not.toMatch(/background:\s*var\(--bg-intense\)/);
    },
  );
});

describe('shared modal theme geometry', () => {
  it('does not make a dialog into a pill under the glass theme', () => {
    const glass = readFileSync('src/renderer/styles/themes/glass.css', 'utf8');
    expect(glass).toContain('body.theme-glass .panel:not(.modal-panel)');
    const modal = readFileSync('src/renderer/components/common/Modal/Modal.tsx', 'utf8');
    expect(modal).toContain('modal-panel');
    expect(modal).toContain('role="dialog"');
  });
});


describe('conversation compact navigation', () => {
  it('suppresses the shared mobile bar with drawer-level specificity because the chat header owns its trigger', () => {
    expect(ruleOf(":root[data-sidebar-layout='drawer'] .ca-chat-panel > .responsive-sidebar__mobile-bar")).toMatch(/display:\s*none/);
  });
});
