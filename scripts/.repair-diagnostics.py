"""Temporary read-only diagnostics for the repair runner; no learner profile."""
from pathlib import Path
import json, re, sys
ansi = re.compile(r'\x1b\[[0-9;]*m')
for name in sys.argv[1:]:
    p = Path(name)
    if not p.exists(): continue
    print('\n=== TEST RESULT', name, '===')
    try: report = json.loads(p.read_text())
    except (ValueError, UnicodeError): continue
    print({key: report.get(key) for key in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','success']})
    for file in report.get('testResults', []):
        failed = [test for test in file.get('assertionResults', []) if test.get('status') == 'failed']
        if not failed and file.get('status') != 'failed': continue
        print(file.get('name'), 'failed:', len(failed))
        seen = set()
        for test in failed:
            message = ansi.sub('', '\n'.join(test.get('failureMessages', [])))
            first = message.split('\n')[0]
            print(' -', test.get('fullName'))
            if first not in seen:
                print(message[:700]); seen.add(first)
        if not failed: print(ansi.sub('', str(file.get('message', '')))[:700])

needles = {
 'src/electron/services/knowledgeHistoryStore.ts': ['retract', 'getKnowledgeState(', 'measurableFold'],
 'src/renderer/learning/questionBank.ts': ['questionBankFromLanguageData'],
 'src/renderer/windows/wordSync/App.test.tsx': ['beforeEach(', 'afterEach('],
 'src/renderer/windows/settings/tabs/SRSTab.tsx': ['shouldShowFrequencySettings', 'hasFreqLevels', 'automaticFlashcardCreation', 'proportionOfLevelCards'],
 'src/electron/services/pythonBackend.test.ts': ['beforeEach(', 'afterEach(', 'resourcesPath', 'getEnvPython'],
}
for file, terms in needles.items():
    lines = Path(file).read_text().splitlines()
    print('\n=== OWNER', file, '===')
    for term in terms:
        matches = [i for i,line in enumerate(lines) if term in line]
        print(term, 'lines', [i+1 for i in matches])
        if term in ['questionBankFromLanguageData','beforeEach(','afterEach(']:
            for i in matches[:2]:
                for j in range(max(0,i-2), min(len(lines),i+55)): print(f'{j+1}: {lines[j]}')
print('\n=== FILES ===')
for directory in ['src/renderer/windows/statistics', 'src/renderer/windows/memoryBrowser', 'scripts/language-data/source/root-of-app/languages']:
    for p in Path(directory).glob('*'):
        if p.is_file(): print(p, p.stat().st_size)
for term in ['autoCreateFlashcardsFromCandidates(', 'createUnseenCards', 'flashcardLLMExamples']:
    print('\n=== CONSUMER', term, '===')
    for p in Path('src').rglob('*'):
        if p.suffix not in ['.ts','.tsx'] or '.test.' in p.name: continue
        for i,line in enumerate(p.read_text().splitlines(),1):
            if term in line: print(f'{p}:{i}: {line[:260]}')
for p in Path('scripts/language-data').rglob('ja*.json'):
    try:
        data = json.loads(p.read_text())
        if not isinstance(data,dict): continue
        print('\n=== JAPANESE METADATA', p, '===', list(data.keys()))
        grammar = data.get('grammar')
        if isinstance(grammar, dict):
            print('grammar keys', list(grammar.keys()))
            for key,value in grammar.items():
                if isinstance(value,list): print(key,len(value),'first keys',list(value[0])[:20] if value and isinstance(value[0],dict) else '')
    except (UnicodeError,ValueError): pass
