import { DEFAULT_SETTINGS } from '../types';
import type { CapabilityKind } from '../graph/types';

/** Strip AnkiConnect HTML from a rendered card side. */
export function ankiPlainText(value: string | undefined): string {
  return (value ?? '')
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A field's existence is not a test: only a withheld answer on verified sides is attributable. */
export function ankiCardCapabilities(card: { fields: Record<string, { value: string }>; question?: string; answer?: string }, word: string, fields?: { expression: string; reading: string; meaning: string }): CapabilityKind[] {
  const expression = ankiPlainText(card.fields[fields?.expression ?? DEFAULT_SETTINGS.anki_field_expression]?.value);
  const reading = ankiPlainText(card.fields[fields?.reading ?? DEFAULT_SETTINGS.anki_field_reading]?.value);
  const meaning = ankiPlainText(card.fields[fields?.meaning ?? DEFAULT_SETTINGS.anki_field_meaning]?.value);
  const question = ankiPlainText(card.question);
  const answer = ankiPlainText(card.answer);
  if (expression !== word || !question || !answer) return [];
  const writtenPrompt = question.includes(expression);
  const readingPrompt = !!reading && question.includes(reading);
  const meaningTested = !!meaning && !question.includes(meaning) && answer.includes(meaning);
  const readingTested = !!reading && !readingPrompt && answer.includes(reading);
  const capabilities: CapabilityKind[] = [];
  if ((writtenPrompt || readingPrompt) && meaningTested) capabilities.push('sense-recognition');
  if (writtenPrompt && readingTested) capabilities.push('surface-reading');
  // A written-only prompt retrieving meaning traverses this written bridge.
  // A supplied reading can bypass that bridge; it must not receive credit.
  if (writtenPrompt && (!readingPrompt || reading === expression) && meaningTested) capabilities.push('surface-recognition');
  return capabilities;
}

