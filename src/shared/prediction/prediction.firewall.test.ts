import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadLinguisticGraph, surfaceEntityId } from '../graph/load';
import { predictTargetAccessibility } from './supportPredictor';

const fixture = {
  schemaVersion: 1 as const,
  language: 'ja',
  generatedAt: '2026-08-23T00:00:00Z',
  sourceVersions: {},
  entities: [
    { id: surfaceEntityId('ja', 'a'), kind: 'surface' as const },
    { id: surfaceEntityId('ja', 'b'), kind: 'surface' as const },
    { id: 'ja:pron:x', kind: 'pronunciation' as const },
  ],
  relations: [
    // SUPPORT with measured predictability: may inform prediction…
    { from: surfaceEntityId('ja', 'b'), to: surfaceEntityId('ja', 'a'), type: 'orthographic-variant-of' as const, transparency: 0.9, predictability: 0.9 },
    // …but NEVER identity.
  ],
};

describe('prediction firewall', () => {
  it('support edges raise predicted accessibility without touching evidence state', () => {
    const graph = loadLinguisticGraph(fixture);
    const prediction = predictTargetAccessibility({
      graph,
      direct: null,
      target: { entityId: surfaceEntityId('ja', 'a'), capability: 'surface-reading' },
      classify: () => 'unknown',
    });
    expect(prediction.kind).toBe('prediction');
    expect(prediction.pSuccess).toBeGreaterThan(0);
    expect(prediction.supportPath).toHaveLength(1);
    // The store is untouched by construction — predictor output is a value,
    // never a writer. Structural proof: this module imports no writer.
  });

  it('imports nothing from evidence-writer modules (structural firewall)', () => {
    const dir = join(__dirname);
    const sources = [
      ...readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.includes('.test.')).map((file) => [file, join(dir, file)] as const),
      ['deCompounds.ts', join(dir, '../graph/morphology/deCompounds.ts')] as const,
    ];
    for (const [file, path] of sources) {
      const src = readFileSync(path, 'utf8');
      expect(src.includes('renderer/context/FlashcardContext'), `${file} imports context`).toBe(false);
      expect(src.includes("from '../../renderer/"), `${file} imports renderer`).toBe(false);
      expect(/appendEvents|setWordKnowledgeEase|recordAttempt/.test(src.replace(/\/\/[^\n]*/g, '')), `${file} references writers`).toBe(false);
    }
  });

  it('uses generated compounds only as read-only support for unseen targets', () => {
    const deGraph = loadLinguisticGraph({
      ...fixture,
      language: 'de',
      entities: ['Papa', 'Hand', 'Schuh'].flatMap((label) => [
        { id: `de:surface:${label}`, kind: 'surface' as const, label },
        { id: `de:entry:${label}`, kind: 'dictionary-entry' as const },
      ]),
      relations: ['Papa', 'Hand', 'Schuh'].map((label) => ({ from: `de:surface:${label}`, to: `de:entry:${label}`, type: 'realizes' as const })),
    });
    const prediction = predictTargetAccessibility({
      graph: deGraph, direct: null,
      target: { entityId: 'de:surface:unseen-papashandschuhe', capability: 'sense-recognition' },
      classify: () => 'unknown',
      compound: { surface: 'Papashandschuhe', isKnownPart: (lemma) => lemma === 'Papa' || lemma === 'Hand' || lemma === 'Schuh' },
    });
    expect(prediction.pSuccess).toBeGreaterThan(0.05);
    expect(prediction.supportPath).toHaveLength(3);
    expect(prediction.kind).toBe('prediction');
  });
});
