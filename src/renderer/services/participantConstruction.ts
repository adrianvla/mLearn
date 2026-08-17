import type { CanonCoordinate, Participant, ParticipantRef, ScenarioGrounding, ScenarioSpec } from '../../shared/world';

export interface ParsedScenarioRequest {
  workTitle?: string;
  characterName?: string;
  characterPageTitle?: string;
  fandomBaseUrl?: string;
  coordinate?: CanonCoordinate;
  freeFormText?: string;
}

export type Resolution =
  | { kind: 'existing'; participant: Participant }
  | { kind: 'ambiguous'; candidates: Participant[]; clarification: string }
  | { kind: 'missing'; query: { name: string; workTitle?: string } };

export interface CastPreviewEntry {
  localId?: string;
  participantId?: string;
  name: string;
  origin: 'existing' | 'canon' | 'invented';
  groundingProvenance: string[];
  fillFlagged: boolean;
}

export interface ConstructedIngress {
  spec: ScenarioSpec;
  createdParticipants: Participant[];
  reusedParticipantIds: string[];
  castPreview: CastPreviewEntry[];
}

export class ScenarioAmbiguityError extends Error {
  constructor(readonly candidates: Participant[]) {
    super(`Ambiguous participant: ${candidates.map(candidateLabel).join(', ')}`);
    this.name = 'ScenarioAmbiguityError';
  }
}

function requestedName(request: ParsedScenarioRequest): string {
  return request.characterName ?? request.characterPageTitle ?? '';
}

function candidateLabel(participant: Participant): string {
  return participant.canon ? `${participant.displayName} (${participant.canon.workTitle})` : participant.displayName;
}

function matchingName(participant: Participant, name: string): boolean {
  return participant.displayName === name || participant.canon?.characterPageTitle === name;
}

export function resolveParticipant(request: ParsedScenarioRequest, participants: Participant[]): Resolution {
  const name = requestedName(request);
  if (request.fandomBaseUrl && request.characterPageTitle) {
    const anchored = participants.find((participant) => {
      const canon = participant.canon;
      return canon?.fandomBaseUrl === request.fandomBaseUrl
        && canon?.characterPageTitle === request.characterPageTitle;
    });
    if (anchored) return { kind: 'existing', participant: anchored };
  }

  const named = participants.filter((participant) => matchingName(participant, name));
  if (request.workTitle) {
    const inWork = named.find((participant) => participant.canon?.workTitle === request.workTitle);
    if (inWork) return { kind: 'existing', participant: inWork };
  }
  if (named.length === 1) return { kind: 'existing', participant: named[0] };
  if (named.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: named,
      clarification: `Which ${name}? ${named.map(candidateLabel).join(', ')}`,
    };
  }
  return { kind: 'missing', query: { name, workTitle: request.workTitle } };
}

function previewProvenance(grounding?: ScenarioGrounding): string[] {
  return grounding?.provenance.map((source) => source.section ? `${source.pageTitle}: ${source.section}` : source.pageTitle) ?? [];
}

export function materializeScenario(
  request: ParsedScenarioRequest,
  participants: Participant[],
  deps: { generateId: () => string; now: number; grounding?: ScenarioGrounding },
): ConstructedIngress {
  const resolution = resolveParticipant(request, participants);
  if (resolution.kind === 'ambiguous') throw new ScenarioAmbiguityError(resolution.candidates);

  const groundingProvenance = previewProvenance(deps.grounding);
  const fillFlagged = (deps.grounding?.fillSegments.length ?? 0) > 0;
  let ref: ParticipantRef;
  let createdParticipants: Participant[] = [];
  let reusedParticipantIds: string[] = [];
  let castPreview: CastPreviewEntry[];

  if (resolution.kind === 'existing') {
    ref = { kind: 'existing', participantId: resolution.participant.id };
    reusedParticipantIds = [resolution.participant.id];
    castPreview = [{
      participantId: resolution.participant.id,
      name: resolution.participant.displayName,
      origin: 'existing',
      groundingProvenance,
      fillFlagged,
    }];
  } else {
    const id = deps.generateId();
    const work = resolution.query.workTitle ? ` from ${resolution.query.workTitle}` : '';
    const profile = {
      name: resolution.query.name,
      personaText: `${resolution.query.name}${work}.`,
      goals: [],
      behaviorConstraints: [],
      initialKnowledge: [],
    };
    const participant: Participant = {
      id,
      displayName: profile.name,
      kind: 'temporary',
      personaText: profile.personaText,
      facets: {},
      setupComplete: true,
    };
    ref = { kind: 'temporary', localId: id, profile };
    createdParticipants = [participant];
    castPreview = [{
      localId: id,
      name: profile.name,
      origin: request.fandomBaseUrl && request.characterPageTitle ? 'canon' : 'invented',
      groundingProvenance,
      fillFlagged,
    }];
  }

  return {
    spec: {
      scene: { sharedFacts: [], userObjectivePrivate: request.freeFormText ?? '', socialConstraints: [] },
      participants: [ref],
      relationships: [],
      grounding: deps.grounding,
      adaptations: [],
    },
    createdParticipants,
    reusedParticipantIds,
    castPreview,
  };
}

export function validateSpec(spec: ScenarioSpec, knownIds: string[]): string[] {
  const violations: string[] = [];
  if (!spec.scene || !Array.isArray(spec.scene.sharedFacts) || typeof spec.scene.userObjectivePrivate !== 'string'
    || !Array.isArray(spec.scene.socialConstraints)) {
    violations.push('Scene fields are required');
  }

  const ids = new Set<string>();
  for (const participant of spec.participants) {
    const id = participant.kind === 'existing' ? participant.participantId : participant.localId;
    if (!id) violations.push('Participant reference id is required');
    else if (ids.has(id)) violations.push(`Duplicate participant reference: ${id}`);
    else ids.add(id);
    if (participant.kind === 'existing' && !knownIds.includes(participant.participantId)) {
      violations.push(`Unknown participant reference: ${participant.participantId}`);
    }
  }

  for (const relationship of spec.relationships) {
    for (const id of [relationship.fromId, relationship.toId]) {
      if (!ids.has(id)) violations.push(`Relationship references unknown participant: ${id}`);
    }
  }
  return violations;
}

function copyCanon(canon: Participant['canon']): Participant['canon'] {
  if (!canon) return undefined;
  return {
    ...canon,
    coordinate: { ...canon.coordinate },
    baseline: {
      ...canon.baseline,
      quotes: canon.baseline.quotes.slice(),
      notYetHappened: canon.baseline.notYetHappened.slice(),
      provenance: canon.baseline.provenance.map((source) => ({ ...source })),
      generatedFill: canon.baseline.generatedFill.slice(),
    },
  };
}

export function advanceCanonCoordinate(participant: Participant, coordinate: CanonCoordinate, now: number): Participant {
  void now;
  const canon = copyCanon(participant.canon);
  if (!canon) return { ...participant, facets: participant.facets ? { ...participant.facets } : undefined };
  return {
    ...participant,
    facets: participant.facets ? { ...participant.facets } : undefined,
    canon: { ...canon, coordinate: { ...coordinate } },
  };
}

export function createSnapshot(participant: Participant, now: number, generateId: () => string): Participant {
  void now;
  return {
    ...participant,
    id: generateId(),
    kind: 'temporary',
    snapshotOf: participant.id,
    facets: participant.facets ? { ...participant.facets } : undefined,
    canon: copyCanon(participant.canon),
    capabilities: participant.capabilities ? { ...participant.capabilities } : undefined,
  };
}
