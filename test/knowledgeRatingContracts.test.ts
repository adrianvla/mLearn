import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = (path: string) => ts.createSourceFile(
  path,
  readFileSync(resolve(process.cwd(), path), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const hasNode = (file: ts.SourceFile, matches: (node: ts.Node) => boolean): boolean => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (matches(node)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

describe('knowledge rating composition contract', () => {
  it.each([
    'src/renderer/components/flashcard/FlashcardReview.tsx',
    'src/renderer/windows/wordSync/WordSyncRating.tsx',
    'src/renderer/windows/levelStudy/PlacementSession.tsx',
    'src/renderer/windows/levelStudy/GrammarCoverage.tsx',
    'src/renderer/windows/main/routes/components/WelcomeFeaturePreviews.tsx',
    'src/renderer/components/common/WordStatusPillKnowledge/WordStatusPillKnowledge.tsx',
  ])('%s imports and renders the shared RatingMatrix', (path) => {
    const file = source(path);
    expect(hasNode(file, (node) => ts.isImportDeclaration(node)
      && node.importClause?.namedBindings !== undefined
      && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some((element) => element.name.text === 'RatingMatrix'))).toBe(true);
    expect(hasNode(file, (node) => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
      && node.tagName.getText(file) === 'RatingMatrix')).toBe(true);
  });

  it.each([
    ['src/renderer/components/flashcard/FlashcardReview.tsx', 'recordAttempt'],
    ['src/renderer/windows/wordSync/App.tsx', 'recordAttempt'],
    ['src/renderer/windows/levelStudy/LevelStudyTab.tsx', 'flashcards.recordAttempt'],
    ['src/renderer/windows/levelStudy/LevelStudyTab.tsx', 'flashcards.recordGrammarAttemptAcknowledged'],
    ['src/renderer/windows/main/routes/WelcomeRoute.tsx', 'flashcards.recordAttempt'],
    ['src/renderer/components/common/WordStatusPillKnowledge/WordStatusPillKnowledge.tsx', 'recordAttempt'],
  ])('%s keeps evidence on %s', (path, writer) => {
    const file = source(path);
    expect(hasNode(file, (node) => ts.isCallExpression(node) && node.expression.getText(file) === writer)).toBe(true);
  });
});
