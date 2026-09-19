/**
 * Dated historical background records (R09).
 *
 * A returned learner's old school grade, exam result, or self-assessment is
 * BACKGROUND for placement: it is evidence about the past, never a current
 * item-level Known claim — nothing in this module writes knowledge, and
 * records are currently STORAGE/DISPLAY-only in the placement panel: they do
 * not yet guide the sampler's starting scope (a W04 policy concern).
 *
 * Open-world: `level`/`provider` are free strings (package-owned scale names
 * such as "N2", "B2", "HSK 3.0 Level 4") — no exam/provider enum lives here.
 * Unknown extra fields on a stored record survive parsing untouched (G03:
 * learner-owned metadata must not be dropped by a strict re-shape).
 */

export type HistoricalBackgroundKind = 'exam' | 'school' | 'self-assessment';

/**
 * A supplied score exactly as printed on the source — verbatim provenance
 * (R09), never a parsed or normalized numeric claim (no scale inference in
 * core; the wording belongs to the learner and the source document). Skill
 * keys are the same free strings as `skillScope`.
 */
export interface HistoricalBackgroundScore {
  /** Overall result as printed ("72/100", "4.0", "gut"). */
  overall?: string;
  /** Per-skill results keyed by free skill names ("reading": "24/30"). */
  skills?: Record<string, string>;
}

export interface HistoricalBackgroundRecord {
  id: string;
  /** Learning language the record describes (ISO code). */
  language: string;
  kind: HistoricalBackgroundKind;
  /** Who issued it / what it was: "Goethe-Zertifikat B2", "Humboldt Jahr 11", "self". */
  label: string;
  /** Level ON THE SOURCE'S OWN SCALE, verbatim from the record (free string). */
  level?: string;
  /** When the result was achieved (ISO date or partial date, verbatim). */
  completedAt?: string;
  /** Skills the result covered ("reading", "listening", "speaking", … free strings). */
  skillScope?: string[];
  /** Optional supplied score(s), captured verbatim — structured provenance
   *  so later placement use can tell a supplied score from free-form prose. */
  score?: HistoricalBackgroundScore;
  /** Optional learner note. */
  note?: string;
  /** Epoch ms when the learner recorded this in mLearn. */
  recordedAt: number;
}

const KINDS: readonly HistoricalBackgroundKind[] = ['exam', 'school', 'self-assessment'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard for one stored record's optional supplied score (R09): overall
 *  and/or per-skill entries, all non-empty verbatim strings; anything else
 *  (including an empty score object, which carries nothing) is malformed. */
function isSuppliedScore(value: unknown): value is HistoricalBackgroundScore {
  if (!isPlainObject(value)) return false;
  const overall = value.overall;
  if (overall !== undefined && (typeof overall !== 'string' || overall === '')) return false;
  const skills = value.skills;
  if (skills !== undefined) {
    if (!isPlainObject(skills)) return false;
    for (const key of Object.keys(skills)) {
      const entry = skills[key];
      if (key === '' || typeof entry !== 'string' || entry === '') return false;
    }
  }
  return overall !== undefined || skills !== undefined;
}

/**
 * Validates the core contract of one stored record. Returns null for
 * malformed rows (never throws — one bad row must not hide the rest).
 * Unknown extra fields are preserved verbatim on the returned record.
 */
export function parseHistoricalBackgroundRecord(input: unknown): HistoricalBackgroundRecord | null {
  if (!isPlainObject(input)) return null;
  const { id, language, kind, label, recordedAt } = input;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof language !== 'string' || language === '') return null;
  if (typeof kind !== 'string' || !KINDS.includes(kind as HistoricalBackgroundKind)) return null;
  if (typeof label !== 'string' || label === '') return null;
  if (typeof recordedAt !== 'number' || !Number.isFinite(recordedAt)) return null;

  const parsed: HistoricalBackgroundRecord = {
    id,
    language,
    kind: kind as HistoricalBackgroundKind,
    label,
    recordedAt,
  };
  // Optional core fields: present-but-mistyped rows are malformed; absent
  // fields stay absent. Present-but-unknown fields ride along untouched.
  for (const key of ['level', 'completedAt', 'note'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value === '') return null;
    parsed[key] = value;
  }
  const skillScope = input.skillScope;
  if (skillScope !== undefined) {
    if (!Array.isArray(skillScope) || !skillScope.every((item) => typeof item === 'string' && item !== '')) return null;
    parsed.skillScope = skillScope as string[];
  }
  const score = input.score;
  if (score !== undefined) {
    if (!isSuppliedScore(score)) return null;
    parsed.score = score;
  }
  for (const key of Object.keys(input)) {
    if (key in parsed) continue;
    (parsed as unknown as Record<string, unknown>)[key] = input[key];
  }
  return parsed;
}

/** Parses a whole stored list; malformed rows are dropped, not fatal. */
export function parseHistoricalBackgroundRecords(input: unknown): HistoricalBackgroundRecord[] {
  if (!Array.isArray(input)) return [];
  const records: HistoricalBackgroundRecord[] = [];
  for (const row of input) {
    const parsed = parseHistoricalBackgroundRecord(row);
    if (parsed !== null) records.push(parsed);
  }
  return records;
}
