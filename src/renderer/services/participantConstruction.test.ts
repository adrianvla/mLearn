import { describe, expect, it } from 'vitest';
import type { Participant, ScenarioSpec } from '../../shared/world';
import {
  ScenarioAmbiguityError,
  advanceCanonCoordinate,
  createSnapshot,
  materializeScenario,
  resolveParticipant,
  validateSpec,
} from './participantConstruction';

function participant(id: string, displayName: string, workTitle: string, chapter: string): Participant {
  return {
    id,
    displayName,
    kind: 'persistent',
    personaText: `${displayName} persona`,
    facets: {},
    canon: {
      workTitle,
      fandomBaseUrl: `https://${workTitle.toLowerCase().split(' ').join('-')}.fandom.com`,
      characterPageTitle: displayName,
      coordinate: { kind: 'chapter', value: chapter },
      baseline: { lore: '', quotes: [], context: '', notYetHappened: [], provenance: [], generatedFill: [] },
    },
    setupComplete: true,
  };
}

describe('participantConstruction', () => {
  it('silently reuses an exact canon identity at its coordinate', () => {
    const izuku = participant('izuku', 'Izuku Midoriya', 'My Hero Academia', '40');
    const request = {
      characterName: 'Izuku Midoriya',
      characterPageTitle: 'Izuku Midoriya',
      workTitle: 'My Hero Academia',
      fandomBaseUrl: 'https://my-hero-academia.fandom.com',
      coordinate: { kind: 'chapter' as const, value: '40' },
    };

    expect(resolveParticipant(request, [izuku])).toEqual({ kind: 'existing', participant: izuku });
    const result = materializeScenario(request, [izuku], { generateId: () => 'new', now: 1 });

    expect(result.createdParticipants).toEqual([]);
    expect(result.reusedParticipantIds).toEqual(['izuku']);
    expect(result.spec.participants).toEqual([{ kind: 'existing', participantId: 'izuku' }]);
  });

  it('requires clarification for name-only matches across works', () => {
    const first = participant('izuku-mha', 'Izuku', 'My Hero Academia', '40');
    const second = participant('izuku-other', 'Izuku', 'Other Work', '1');
    const request = { characterName: 'Izuku' };
    const resolution = resolveParticipant(request, [first, second]);

    expect(resolution).toMatchObject({ kind: 'ambiguous', candidates: [first, second] });
    if (resolution.kind === 'ambiguous') expect(resolution.clarification).toContain('My Hero Academia');
    expect(() => materializeScenario(request, [first, second], { generateId: () => 'new', now: 1 }))
      .toThrow(ScenarioAmbiguityError);
    try {
      materializeScenario(request, [first, second], { generateId: () => 'new', now: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioAmbiguityError);
      if (error instanceof ScenarioAmbiguityError) expect(error.candidates).toEqual([first, second]);
    }
  });

  it('reuses across coordinates, advances in place by identity, and snapshots without mutation', () => {
    const izuku = participant('izuku', 'Izuku Midoriya', 'My Hero Academia', '150');
    const original = JSON.parse(JSON.stringify(izuku)) as Participant;
    const request = {
      characterName: 'Izuku Midoriya',
      characterPageTitle: 'Izuku Midoriya',
      fandomBaseUrl: 'https://my-hero-academia.fandom.com',
      coordinate: { kind: 'chapter' as const, value: '40' },
    };

    expect(resolveParticipant(request, [izuku])).toEqual({ kind: 'existing', participant: izuku });
    const advanced = advanceCanonCoordinate(izuku, { kind: 'chapter', value: '40' }, 1);
    const snapshot = createSnapshot(izuku, 1, () => 'izuku-snapshot');

    expect(advanced.id).toBe(izuku.id);
    expect(advanced.canon?.coordinate).toEqual({ kind: 'chapter', value: '40' });
    expect(snapshot).toMatchObject({ id: 'izuku-snapshot', kind: 'temporary', snapshotOf: 'izuku' });
    expect(izuku).toEqual(original);
  });

  it('validates dangling relationship references', () => {
    const valid: ScenarioSpec = {
      scene: { sharedFacts: [], userObjectivePrivate: '', socialConstraints: [] },
      participants: [{ kind: 'existing', participantId: 'izuku' }],
      relationships: [],
      adaptations: [],
    };

    expect(validateSpec(valid, ['izuku'])).toEqual([]);
    expect(validateSpec({
      ...valid,
      relationships: [{ fromId: 'izuku', toId: 'missing', label: 'rivals', directional: true }],
    }, ['izuku'])).toContain('Relationship references unknown participant: missing');
  });

  it('keeps the user objective out of every temporary participant-facing field', () => {
    const objective = 'Convince Tanaka-the-boss to reveal the secret merger plan.';
    const result = materializeScenario({ characterName: 'Tanaka-the-boss', workTitle: 'Office Drama', freeFormText: objective }, [], {
      generateId: () => 'tanaka',
      now: 1,
    });
    const ref = result.spec.participants[0];

    expect(ref.kind).toBe('temporary');
    if (ref.kind !== 'temporary') throw new Error('Expected temporary participant');
    const participantFields = [
      ref.profile.personaText,
      ...ref.profile.goals,
      ...ref.profile.initialKnowledge.map((fact) => fact.text),
    ];
    expect(participantFields.join('\n')).not.toContain(objective);
  });
});
