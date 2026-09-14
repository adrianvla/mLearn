import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/windows/conversationAgent/ConversationAgent.css', 'utf8');

/** Body of the rule whose selector starts a line and matches exactly. */
const ruleOf = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

// The details drawer, voice overlay, and (drawer-layout) history sidebar are
// painted on top of chat content. --bg / --bg-primary are translucent in every
// theme and the high-contrast themes disable backdrop filters entirely, so a
// translucent surface here lets chat bleed through unblurred. Overlapping
// surfaces must use an opaque token (--bg-nt-*, --bg-opaque).
describe('conversation agent overlapping surfaces', () => {
  it.each(['.ca-details-drawer', '.ca-voice-overlay', '.ca-history-sidebar'])(
    '%s paints an opaque surface, not a translucent alias',
    (selector) => {
      const body = ruleOf(selector);
      expect(body).not.toBe('');
      expect(body).toMatch(/background:\s*var\(--bg-(nt-|opaque)/);
      expect(body).not.toMatch(/background:\s*var\(--bg-intense\)/);
    },
  );
});
