// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ParticipantAvatarGroup, type AvatarParticipant } from './ParticipantAvatarGroup';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });

const person = (id: string, displayName: string, profilePhoto?: string): AvatarParticipant => ({ id, displayName, profilePhoto });
const mount = (participants: AvatarParticipant[]) => {
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <ParticipantAvatarGroup participants={participants} />, root);
  return root;
};

describe('ParticipantAvatarGroup', () => {
  it('renders no avatar for an empty roster and preserves the regular single-avatar fallback', () => {
    const empty = mount([]);
    expect(empty.querySelector('[data-testid="participant-avatar-group"]')).toBeNull();
    dispose?.();
    const single = mount([person('one', 'Long Contact Name')]);
    expect(single.querySelectorAll('.participant-avatar-group__slot')).toHaveLength(1);
    expect(single.querySelector('.avatar')?.textContent).toBe('LN');
  });

  it('shows two photos in roster order and keeps per-person initial fallbacks', () => {
    const root = mount([person('first-id', 'Alex', 'file:///first.png'), person('second-id', 'Alex')]);
    expect(Array.from(root.querySelectorAll('.participant-avatar-group__slot')).map(slot => slot.getAttribute('data-participant-id')))
      .toEqual(['first-id', 'second-id']);
    expect(root.querySelectorAll('img')).toHaveLength(1);
    const broken = root.querySelector('img')!;
    broken.dispatchEvent(new Event('error'));
    expect(root.querySelector('[data-participant-id="first-id"] .avatar')?.textContent).toBe('A');
    expect(root.querySelectorAll('.participant-avatar-group__slot')).toHaveLength(2);
  });

  it('uses a bounded four-slot layout and a deterministic overflow count for larger rosters', () => {
    const four = mount([person('a', 'A'), person('b', 'B'), person('c', 'C'), person('d', 'D')]);
    expect(four.querySelector('[data-testid="participant-avatar-group"]')?.getAttribute('data-slot-count')).toBe('4');
    expect(four.querySelectorAll('.participant-avatar-group__slot')).toHaveLength(4);
    dispose?.();
    const many = mount([person('a', 'Same'), person('b', 'Same'), person('c', 'Same'), person('d', 'Same'), person('e', 'Same'), person('f', 'Same')]);
    expect(many.querySelector('[data-testid="participant-avatar-group"]')?.getAttribute('data-total-count')).toBe('6');
    expect(many.querySelectorAll('.participant-avatar-group__slot')).toHaveLength(3);
    expect(many.querySelector('.participant-avatar-group__overflow')?.textContent).toBe('+3');
  });

  it('updates its identity and ordering when roster membership changes', () => {
    const [participants, setParticipants] = createSignal([person('a', 'Alex'), person('b', 'Alex')]);
    const root = document.createElement('div'); document.body.append(root);
    dispose = render(() => <ParticipantAvatarGroup participants={participants()} />, root);
    setParticipants([person('b', 'Alex'), person('c', 'New participant')]);
    expect(Array.from(root.querySelectorAll('.participant-avatar-group__slot')).map(slot => slot.getAttribute('data-participant-id')))
      .toEqual(['b', 'c']);
  });
});
