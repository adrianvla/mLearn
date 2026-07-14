import { Button, Label, ListBox, ListBoxItem, Modal, SearchField, useOverlayState } from '@heroui/react';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../api/client';
import { useGroupScope } from '../groups/GroupScopeProvider';

type SearchKind = 'user' | 'group' | 'policy';

type SearchResult = {
  kind: SearchKind;
  id: string;
  groupId: string;
  title: string;
  subtitle: string;
  href: string;
};

type SearchResponse = { results: SearchResult[] };

const api = new ApiClient();
export function GlobalSearch() {
  const navigate = useNavigate();
  const scope = useGroupScope();
  const requestId = useRef(0);
  const selecting = useRef(false);
  const preserveQueryAfterFailedSelection = useRef(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const overlay = useOverlayState({ isOpen, onOpenChange: setIsOpen });

  const loadResults = (value: string) => {
    if (preserveQueryAfterFailedSelection.current) {
      preserveQueryAfterFailedSelection.current = false;
      return;
    }
    selecting.current = false;
    setQuery(value);
    const normalized = value.trim();
    if (normalized.length < 2 || normalized.length > 100) {
      requestId.current += 1;
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    void api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(normalized)}&limit=10`)
      .then((response) => {
        if (currentRequest !== requestId.current) return;
        setResults(response.results);
        setError(null);
        setIsLoading(false);
      })
      .catch((reason: unknown) => {
        if (currentRequest !== requestId.current) return;
        setResults([]);
        setError(reason instanceof Error ? reason.message : 'Unable to search');
        setIsLoading(false);
      });
  };

  const selectResult = async (key: React.Key | null) => {
    if (key === null || selecting.current) return;
    const result = results.find((item) => resultKey(item) === key);
    if (!result) return;
    selecting.current = true;
    requestId.current += 1;
    try {
      if (scope.status !== 'ready') throw new Error('Group scope is unavailable');
      await scope.selectGroup(result.groupId, { preserveCurrentScope: true });
      setQuery('');
      setResults([]);
      setError(null);
      setIsOpen(false);
      navigate(result.href);
    } catch {
      selecting.current = false;
      preserveQueryAfterFailedSelection.current = true;
      setResults([]);
      setError('Unable to switch to the selected group');
    }
  };

  return (
    <>
      <Button variant="secondary" isIconOnly aria-label="Search" onPress={() => setIsOpen(true)}><Search aria-hidden="true" /></Button>
      {isOpen ? <Modal state={overlay}>
        <Modal.Backdrop>
          <Modal.Container size="lg" placement="top">
            <Modal.Dialog aria-label="Search the console">
              <Modal.Header><Modal.Heading>Search the console</Modal.Heading></Modal.Header>
              <Modal.Body>
                <SearchField value={query} onChange={loadResults} onSubmit={() => void selectResult(results[0] ? resultKey(results[0]) : null)} fullWidth>
                  <Label>Search users, groups, and policies</Label>
                  <SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Type at least two characters" /><SearchField.ClearButton /></SearchField.Group>
                </SearchField>
                {results.length > 0 ? <ListBox aria-label="Search results" items={results} selectionMode="single" onSelectionChange={(keys) => {
                  const key = keys === 'all' ? null : [...keys][0] ?? null;
                  void selectResult(key);
                }}>
                  {(item) => <ListBoxItem id={resultKey(item)} aria-label={`${item.title}, ${item.subtitle}`} textValue={item.title}>
                    {kindLabel(item.kind)} · {item.title} — {item.subtitle}
                  </ListBoxItem>}
                </ListBox> : null}
                {error ? <p role="alert">{error}</p> : isLoading ? <p role="status">Searching…</p> : isSearchableQuery(query) && results.length === 0 ? <p role="status">No users, groups, or policies found.</p> : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal> : null}
    </>
  );
}

function resultKey(result: SearchResult): string {
  return `${result.kind}:${result.id}`;
}

function isSearchableQuery(value: string): boolean {
  const length = value.trim().length;
  return length >= 2 && length <= 100;
}

function kindLabel(kind: SearchKind): string {
  if (kind === 'user') return 'User';
  if (kind === 'group') return 'Group';
  return 'Policy';
}
