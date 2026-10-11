"""Temporary, assertion-anchored repair runner. Removed from the final branch."""
from pathlib import Path
import runpy
base = runpy.run_path('scripts/.apply-v29-ui-repair.py')
edit, changed = base['edit'], base['changed']

def replace_block(name, start, end, replacement=''):
    text = Path(name).read_text()
    assert text.count(start) == 1, (name, start)
    begin = text.index(start)
    stop = text.index(end, begin)
    edit(name, text[begin:stop], replacement)

# Node's SQLite binding truncates TEXT at NUL. Fetch opaque keys as bytes without
# changing the schema, address identity, or historical journal.
history = 'src/electron/services/knowledgeHistoryStore.ts'
edit(history,
    'SELECT DISTINCT bucket, seq FROM attempt_index WHERE key = ? AND attempt_id IN (${placeholders})',
    'SELECT DISTINCT CAST(bucket AS BLOB) AS bucket, seq FROM attempt_index WHERE key = ? AND attempt_id IN (${placeholders})')
edit(history,
    '.all(key, ...retractedIds) as Array<{ bucket: string; seq: number }>) {\n      const seqs = affected.get(row.bucket) ?? new Set<number>();\n      seqs.add(row.seq);\n      affected.set(row.bucket, seqs);',
    '.all(key, ...retractedIds) as Array<{ bucket: Uint8Array; seq: number }>) {\n      // Preserve the complete capability/address key, including its NUL separator.\n      const bucket = Buffer.from(row.bucket).toString(\'utf8\');\n      const seqs = affected.get(bucket) ?? new Set<number>();\n      seqs.add(row.seq);\n      affected.set(bucket, seqs);')
edit(history, 'SELECT rec, bucket, attempt_id FROM attempt_index WHERE key = ? AND attempt_id = ?', 'SELECT rec, CAST(bucket AS BLOB) AS bucket, attempt_id FROM attempt_index WHERE key = ? AND attempt_id = ?')
edit(history, 'as Array<{ rec: Uint8Array; bucket: string; attempt_id: string }>', 'as Array<{ rec: Uint8Array; bucket: Uint8Array; attempt_id: string }>')
edit(history, '...bucketRepresentative(row.bucket), ...record.event', "...bucketRepresentative(Buffer.from(row.bucket).toString('utf8')), ...record.event")

pack = 'scripts/language-data/package-language-data.mjs'
edit(pack,
    "  execFileSync('tar', [\n    '--format',\n    'ustar',\n    '--uid',\n    '0',\n    '--gid',\n    '0',\n    '--uname',\n    'root',\n    '--gname',\n    'root',",
    "  const tarVersion = execFileSync('tar', ['--version'], { encoding: 'utf8' });\n  const ownershipArgs = /GNU tar/.test(tarVersion)\n    ? ['--owner=root:0', '--group=root:0']\n    : ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root'];\n  execFileSync('tar', [\n    '--format',\n    'ustar',\n    ...ownershipArgs,")

# Retire controls without runtime consumers; keep old persisted fields readable.
srs = 'src/renderer/windows/settings/tabs/SRSTab.tsx'
replace_block(srs,
    "        <SettingRow\n          label={t('mlearn.Settings.SRS.BuiltInFlashcards.AutomaticCreation.Label')}",
    "        <SettingRow\n          label={t('mlearn.Settings.SRS.BuiltInFlashcards.MaxNewCards.Label')}")
replace_block(srs,
    '        <Show when={shouldShowFrequencySettings(hasFreqLevels(), isSettingManaged)}>',
    "        <SettingRow\n          label={t('mlearn.Settings.SRS.BuiltInFlashcards.CreateUnseenCards.Label')}")
edit(srs, 'shouldShowAnkiSettings, shouldShowFrequencySettings', 'shouldShowAnkiSettings')
edit(srs, 'const { getLanguageFeatures, currentLangData } = useLanguage();', 'const { currentLangData } = useLanguage();')
edit(srs, '  const hasFreqLevels = createMemo(() => getLanguageFeatures().supportsFrequencyLevels);\n', '')

# Authorization happens before section selection. Do not hide authorized memories
# merely because no room-culture/relationship entries exist.
memory = 'src/renderer/windows/memoryBrowser/App.tsx'
edit(memory,
    "          { title: t('mlearn.MemoryBrowser.Sections.RoomCulture'), entries: view.roomCulture },\n          { title: t('mlearn.MemoryBrowser.Sections.Relationships'), entries: view.relationships },",
    "          { title: t('mlearn.MemoryBrowser.Sections.RoomCulture'), entries: view.roomCulture },\n          { title: t('mlearn.MemoryBrowser.Sections.Beliefs'), entries: view.beliefs },\n          { title: t('mlearn.MemoryBrowser.Sections.OpenLoops'), entries: view.openLoops },\n          { title: t('mlearn.MemoryBrowser.Sections.Episodes'), entries: view.episodes },\n          { title: t('mlearn.MemoryBrowser.Sections.Relationships'), entries: view.relationships },")

# Preserve the production safeguard added for 迫る. Old renderer fixtures must
# supply the reading-bound records produced by actual dictionary packages.
subtitle = 'src/renderer/components/subtitle/SubtitleWord.pitchAccent.test.tsx'
edit(subtitle,
    "{ definitions: ['when'], reading: 'いつ' },\n        undefined,\n        { pitches: [{ position: 1 }] },",
    "{ definitions: ['when'], reading: 'いつ' },\n        undefined,\n        { reading: 'いつ', pitches: [{ position: 1 }] },")
entry = 'src/renderer/windows/wordDbEditor/components/WordEntryRow.test.tsx'
edit(entry,
    "  it('draws cached pitch accent on every displayed alternate reading even when the row primary reading differs', async () => {\n",
    "  it('draws cached pitch accent on every displayed alternate reading even when the row primary reading differs', async () => {\n    const parsers = await vi.importActual<typeof import('../../../utils/translationCacheParsers')>('../../../utils/translationCacheParsers');\n    extractProsodyDataMock.mockImplementation(parsers.extractProsodyData);\n")

# Fault injection belongs on Storage's real prototype, not the named-property
# Proxy used by Happy DOM. Always restore before touching persistent test state.
sync_test = 'src/renderer/windows/wordSync/App.test.tsx'
s = Path(sync_test).read_text()
for method in ['setItem', 'removeItem']:
    before = f"vi.spyOn(localStorage, '{method}')"
    count = s.count(before)
    if count:
        edit(sync_test, before, f"vi.spyOn(Storage.prototype, '{method}')", count)
        s = Path(sync_test).read_text()
edit(sync_test, 'beforeEach(() => {\n    const lockChains', 'beforeEach(() => {\n    vi.restoreAllMocks();\n    const lockChains')
edit(sync_test, '    while (disposals.length) disposals.pop()!();', '    while (disposals.length) disposals.pop()!();\n    vi.restoreAllMocks();')

css = 'src/renderer/windows/statistics/Dashboard.css'
edit(css, '@media (max-width: 950px) {\n  .level-table,', '@media (max-width: 950px) {\n  .level-table { min-width: 0; }\n  .level-table,')
Path('/tmp/mlearn-ui-changed-files.txt').write_text('\n'.join(sorted(changed))+'\n')
print('Full changed source list:', *sorted(changed), sep='\n')
