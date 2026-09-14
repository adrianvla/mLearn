import { USER_ACTOR, HARNESS_ACTOR, type ScenarioSpec, type RuntimeProfile, type ParticipantRef } from './world';

export const SCENARIO_LIMITS = { cast: 6, facts: 16, text: 1500, persona: 4000, outputCharacters: 24000, intent: 4000 } as const;

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scenario contains an invalid object');
  return value as RecordValue;
}
function text(value: unknown, limit: number = SCENARIO_LIMITS.text): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Scenario contains invalid or oversized text');
  return value;
}
function list(value: unknown, limit: number = SCENARIO_LIMITS.facts): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Scenario contains an invalid or oversized list');
  return value;
}
function texts(value: unknown): string[] { return list(value).map(item => text(item)); }

/** Model output is a proposal. IDs, knowledge audiences and permission-bearing fields are validated before staging. */
export function parseScenarioProposal(raw: string, selectedIds: string[], objective: string): ScenarioSpec {
  if (raw.length > SCENARIO_LIMITS.outputCharacters) throw new Error('Scenario output exceeded its budget');
  const value = record(JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')));
  if (value.grounding !== undefined) throw new Error('Generated scenarios cannot claim researched source grounding');
  const scene = record(value.scene);
  const allowedExisting = new Set(selectedIds);
  const ids = new Set<string>();
  const participants: ParticipantRef[] = list(value.participants, SCENARIO_LIMITS.cast).map(item => {
    const candidate = record(item);
    const existing = candidate.kind === 'existing';
    if (!existing && candidate.kind !== 'temporary') throw new Error('Invalid scenario participant kind');
    const id = text(existing ? candidate.participantId : candidate.localId, 160);
    if (!id || id === USER_ACTOR || id === HARNESS_ACTOR || ids.has(id)) throw new Error('Invalid or duplicate scenario identity');
    ids.add(id);
    if (existing) {
      if (!allowedExisting.has(id)) throw new Error('Scenario referenced an unselected person');
      return { kind: 'existing', participantId: id };
    }
    if (allowedExisting.has(id)) throw new Error('Scenario cannot replace an existing person');
    const profile = record(candidate.profile);
    if (profile.capabilities !== undefined) throw new Error('Scenario cannot assign runtime authority');
    const name = text(profile.name, 160).trim();
    const personaText = text(profile.personaText, SCENARIO_LIMITS.persona).trim();
    if (!name || !personaText) throw new Error('Scenario individuals need a name and persona');
    const runtime: RuntimeProfile = { name, personaText, goals: texts(profile.goals),
      behaviorConstraints: texts(profile.behaviorConstraints),
      initialKnowledge: list(profile.initialKnowledge).map(fact => {
        const entry = record(fact);
        return { text: text(entry.text), witnesses: texts(entry.witnesses) };
      }),
    };
    return { kind: 'temporary', localId: id, profile: runtime };
  });
  if (!participants.length || selectedIds.some(id => !ids.has(id))) throw new Error('Scenario must include the selected cast');
  for (const participant of participants) {
    if (participant.kind !== 'temporary') continue;
    for (const fact of participant.profile.initialKnowledge) {
      if (!fact.witnesses.includes(participant.localId) || fact.witnesses.some(id => !ids.has(id))) {
        throw new Error('Scenario knowledge has an invalid witness scope');
      }
    }
  }
  const relationships = list(value.relationships).map(item => {
    const relation = record(item);
    const fromId = text(relation.fromId, 160), toId = text(relation.toId, 160);
    if (!ids.has(fromId) || !ids.has(toId) || fromId === toId || relation.directional !== true) {
      throw new Error('Scenario relationship references an invalid person');
    }
    return { fromId, toId, label: text(relation.label, 400), directional: true as const };
  });
  return {
    scene: { sharedFacts: texts(scene.sharedFacts), socialConstraints: texts(scene.socialConstraints), userObjectivePrivate: objective },
    participants, relationships, adaptations: texts(value.adaptations),
  };
}
