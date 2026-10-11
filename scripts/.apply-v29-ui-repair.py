"""One-shot source edits for the isolated repair branch; removed after verification."""
from pathlib import Path
changed = set()
def edit(name, before, after, count=1):
    path = Path(name)
    text = path.read_text()
    actual = text.count(before)
    if actual != count:
        raise RuntimeError(f'{name}: expected {count} exact anchors, found {actual}: {before[:100]!r}')
    path.write_text(text.replace(before, after, count))
    changed.add(name)

review = 'src/renderer/components/flashcard/FlashcardReview.css'
edit(review, '.flashcard-study-encounter .flashcard-face {', '.flashcard-study-encounter .flashcard-face:not(.flashcard-face--hidden) {', 2)
edit(review, 'width: min(100%, 48rem);\n  margin-block: auto;', 'width: min(100%, 37.5rem);\n  margin-block: var(--spacing-4) 0;\n  flex: 0 0 auto;')
edit(review, '.flashcard-study-encounter .flashcard-container {\n  max-width: 48rem;\n}', '.flashcard-study-encounter .flashcard-container {\n  max-width: 500px;\n}')
edit(review, 'min-height: clamp(15rem, 42vh, 28rem);', 'min-height: 300px;')
review_ts = 'src/renderer/components/flashcard/FlashcardReview.tsx'
edit(review_ts, '{/* Header with stats */}\n        <div class="flashcard-review-header">', '{/* Scheduler overview is independent of the utility toolbar. */}\n        <div class="flashcard-review-overview">')
edit(review_ts, '          <div class="flashcard-header-actions">\n        <div class="review-activity-preferences">', '        </div>\n        <div class="flashcard-review-header">\n          <div class="flashcard-header-actions">\n        <div class="review-activity-preferences">')
edit(review, '/* Floating review controls stay grouped while each group can wrap on narrow windows. */', '''/* Counts describe the scheduler, not actions on the displayed card. */
.flashcard-review-overview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2) var(--spacing-4);
  flex: 0 0 auto;
  min-width: 0;
  width: 100%;
}

/* Review controls stay grouped while each group can wrap on narrow windows. */''')
face = 'src/renderer/components/flashcard/FlashcardDisplay.css'
edit(face, '.flashcard-face {\n', '.flashcard-face {\n  box-sizing: border-box;\n')
nav = 'src/renderer/windows/main/routes/components/ReaderNav.css'
edit(nav, 'padding: calc(0.5rem + var(--window-controls-block-start-inset)) 1rem 0.5rem max(1rem, calc(1rem + var(--window-controls-inline-start-inset)));', 'padding: 0.5rem 1rem 0.5rem max(1rem, calc(1rem + var(--window-controls-inline-start-inset)));')
edit(nav, 'min-height: calc(48px + var(--window-controls-block-start-inset));', 'min-height: 48px;')
shell = 'src/renderer/windows/main/ApplicationShell.css'
edit(shell, 'padding: calc(var(--spacing-2) + var(--window-controls-block-start-inset)) var(--spacing-4) var(--spacing-2);', 'padding: var(--spacing-2) var(--spacing-4);')
home = 'src/renderer/windows/main/routes/welcome.css'
edit(home, 'padding-inline-start: max(var(--spacing-6), calc(var(--spacing-6) + var(--window-controls-inline-start-inset)));', 'padding-inline-start: var(--spacing-6);')
edit(home, '.welcome-record-details > summary { cursor: pointer; width: fit-content; }', '''.welcome-record-details > summary { display: flex; align-items: center; gap: var(--spacing-1); cursor: pointer; width: fit-content; list-style: none; }
.welcome-record-details > summary::-webkit-details-marker { display: none; }
.welcome-record-details > summary svg { transform: rotate(-90deg); }
.welcome-record-details[open] > summary svg { transform: none; }''')
summary = 'src/renderer/windows/main/routes/components/WelcomeLearningSummary.tsx'
edit(summary, 'import { Button, LearningGoals }', 'import { Button, ChevronDownIcon, LearningGoals }')
edit(summary, "<summary>{t('mlearn.Home.Summary.RecordDetails')}</summary>", "<summary><span aria-hidden=\"true\"><ChevronDownIcon size={14} /></span>{t('mlearn.Home.Summary.RecordDetails')}</summary>")
edit(summary, '<dl class="welcome-lifetime-totals"><div>', '<Show when={hasActiveGoal()}><dl class="welcome-lifetime-totals"><div>')
edit(summary, '</dd></div></dl>\n          <p class="welcome-summary-definition">', '</dd></div></dl></Show>\n          <p class="welcome-summary-definition">')
edit(home, '.welcome-conversation-message { -webkit-line-clamp: 2; margin: 0; font-size: var(--font-size-sm); }', '''.welcome-conversation-message {
  -webkit-line-clamp: 3;
  margin: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  border-start-start-radius: var(--radius-sm);
  background: var(--bg);
  font-size: var(--font-size-sm);
}''')
plan = 'src/renderer/windows/levelStudy/LevelStudy.css'
edit(plan, '.level-study-content {\n  flex: 1;\n', '.level-study-content {\n  flex: 1;\n  min-height: 0;\n')
edit(plan, '.level-card-card-legend {\n  display: grid;\n  grid-template-columns: 1fr 1fr;', '.level-card-card-legend {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));')
edit(plan, '  white-space: normal;\n  overflow-wrap: anywhere;\n}\n.level-card-legend-label:hover', '  white-space: normal;\n  overflow-wrap: normal;\n}\n.level-card-legend-label:hover')
print('Patched source files:')
for name in sorted(changed): print(name)
Path('/tmp/mlearn-ui-changed-files.txt').write_text('\n'.join(sorted(changed))+'\n')
