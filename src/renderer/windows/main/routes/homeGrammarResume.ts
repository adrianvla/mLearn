import type { LanguageData } from '../../../../shared/types';
import { readStudySessionRecord } from '../../../learning/studySessionController';

interface GrammarContinuityMeta {
  level: number;
  kind: 'self-assess' | 'contrast';
  denominator: string;
  scopePatterns?: string[];
  presentedAt?: number;
}

/** A continuity hint only. The existing grammar owner validates executable items and owns all mutations. */
export function homeGrammarResume(storage: Pick<Storage, 'getItem'>, language: string, data: LanguageData | null | undefined) {
  const declared = data?.grammar;
  if (!declared?.length) return null;
  try {
    const record = readStudySessionRecord<{ id: string }, unknown, unknown, GrammarContinuityMeta>(
      storage.getItem(`mlearn-study-grammar:${language}`), record => {
        const meta = record.meta;
        if (!meta || !['self-assess', 'contrast'].includes(meta.kind) || typeof meta.denominator !== 'string') return false;
        const ids = new Set(declared.filter(point => point.level === meta.level).map(point => point.pattern));
        if (record.index < 0 || record.index >= record.queue.length || !record.queue.length
          || record.queue.some(item => !item || !ids.has(item.id)) || new Set(record.queue.map(item => item.id)).size !== record.queue.length) return false;
        const scope = meta.scopePatterns;
        if (scope !== undefined && (!Array.isArray(scope) || !scope.length || new Set(scope).size !== scope.length || scope.some(id => !ids.has(id)))) return false;
        if (record.identity !== JSON.stringify({ language, level: meta.level, kind: meta.kind, denominator: meta.denominator })) return false;
        if (record.queue.map(item => item.id).sort().join('\u0000') !== meta.denominator) return false;
        if (meta.kind === 'self-assess') {
          const members = scope ?? [...ids];
          if ([...members].sort().join('\u0000') !== meta.denominator || record.queue.map(item => item.id).sort().join('\u0000') !== meta.denominator) return false;
        }
        return true;
      });
    if (!record) return null;
    return { label: record.queue[record.index].id, at: Number.isFinite(record.meta.presentedAt) ? record.meta.presentedAt! : 0,
      context: { activity: 'grammar' as const, patterns: record.queue.map(item => item.id) } };
  } catch { return null; }
}
