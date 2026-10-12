"""Recover the interrupted patch from its persisted source, without reimplementing it.
Temporary runner; never promoted to the application branch.
"""
from pathlib import Path
import runpy

sync = Path('src/renderer/windows/wordSync/App.test.tsx')
original_sync_test = sync.read_text()
repair = runpy.run_path('scripts/.apply-repair-correctness.py')
edit, changed = repair['edit'], repair['changed']
# The prototype-spy experiment did not intercept actual storage calls. Restore
# the original test until the real storage implementation has been inspected.
sync.write_text(original_sync_test)
changed.discard(str(sync))
edit('src/renderer/windows/settings/tabs/SRSTab.tsx',
     'Component, createSignal, Show, createMemo, createEffect, on',
     'Component, createSignal, Show, createEffect, on')
# Match the existing production contract: a package must identify its displayed
# prosody field and the source record must bind it to the displayed reading.
preview = 'src/renderer/windows/flashcards/flashcardsSuggestedPreview.test.ts'
edit(preview, "prosody: { type: 'tone-contour' },", "prosody: { type: 'tone-contour', displayPath: ['tone'] },")
edit(preview, "{ tone: 'falling' }", "{ reading: 'salaam', tone: 'falling' }", 2)
Path('/tmp/mlearn-ui-changed-files.txt').write_text('\n'.join(sorted(changed)) + '\n')
