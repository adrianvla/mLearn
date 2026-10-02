// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { CallParticipants } from './CallParticipants';
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key.split('.').at(-1) }) }));

describe('CallParticipants', () => {
  it('keeps identities visible and distinguishes contact samples from the shared system voice', () => {
    const container = document.createElement('div');
    const [speaker, setSpeaker] = createSignal<string | null>(null);
    const dispose = render(() => <CallParticipants participants={[
      { id: 'one', displayName: 'First person', voiceSampleId: 'sample-one' },
      { id: 'two', displayName: 'Second person' },
    ]} speakingActorId={speaker()} usingVoiceSamples voiceLabel="System voice" />, container);
    const cards = container.querySelectorAll('.call-participant');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('First personVoiceSample');
    expect(cards[1].textContent).toContain('Second personSystem voice');
    expect(container.querySelector('.call-participant--speaking')).toBeNull();
    setSpeaker('two');
    expect(container.querySelector('.call-participant--speaking')?.getAttribute('data-participant-id')).toBe('two');
    setSpeaker(null);
    expect(container.querySelector('.call-participant--speaking')).toBeNull();
    dispose();
  });
});
