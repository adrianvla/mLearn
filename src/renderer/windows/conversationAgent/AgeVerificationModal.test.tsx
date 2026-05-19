// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';
import { render } from 'solid-js/web';
import { AgeVerificationModal } from './AgeVerificationModal';

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'mlearn.ConversationAgent.AgeVerification.Title': 'AI Conversation Agent — Age Verification',
        'mlearn.ConversationAgent.AgeVerification.AIWarning': 'AI responses may be inaccurate.',
        'mlearn.ConversationAgent.AgeVerification.SafetyNotice': 'Safety screening is ON.',
        'mlearn.ConversationAgent.AgeVerification.AgeVerificationText': 'You must be 18+.',
        'mlearn.ConversationAgent.AgeVerification.Certification': 'By continuing, you certify you are 18+.',
        'mlearn.ConversationAgent.AgeVerification.ContinueButton': 'Continue to Chat',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('../../components/common', () => ({
  Btn: (props: { onClick?: () => void; children?: unknown }) => (
    <button type="button" onClick={props.onClick}>
      {props.children as string}
    </button>
  ),
}));

describe('AgeVerificationModal', () => {
  it('renders the disclaimer title', () => {
    const container = document.createElement('div');
    render(() => <AgeVerificationModal onAccept={vi.fn()} />, container);
    expect(container.textContent).toContain('AI Conversation Agent — Age Verification');
  });

  it('renders all disclaimer sections', () => {
    const container = document.createElement('div');
    render(() => <AgeVerificationModal onAccept={vi.fn()} />, container);
    expect(container.textContent).toContain('AI responses may be inaccurate.');
    expect(container.textContent).toContain('Safety screening is ON.');
    expect(container.textContent).toContain('You must be 18+.');
    expect(container.textContent).toContain('By continuing, you certify you are 18+.');
  });

});
