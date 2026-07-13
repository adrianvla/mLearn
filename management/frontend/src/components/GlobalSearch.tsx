import { ComboBox, Input, Label, ListBox, ListBoxItem } from '@heroui/react';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { Header, ListBoxSection } from 'react-aria-components';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../api/client';
import { useGroupScope } from '../groups/GroupScopeProvider';
import './GlobalSearch.css';

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
const groups: Array<{ kind: SearchKind; label: string }> = [
  { kind: 'user', label: 'Users' },
  { kind: 'group', label: 'Groups' },
  { kind: 'policy', label: 'Policies' },
];

export function GlobalSearch() {
  const navigate = useNavigate();
  const scope = useGroupScope();
  const requestId = useRef(0);
  const selecting = useRef(false);
  const preserveQueryAfterFailedSelection = useRef(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      return;
    }
    const currentRequest = ++requestId.current;
    void api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(normalized)}&limit=10`)
      .then((response) => {
        if (currentRequest !== requestId.current) return;
        setResults(response.results);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (currentRequest !== requestId.current) return;
        setResults([]);
        setError(reason instanceof Error ? reason.message : 'Unable to search');
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
      navigate(result.href);
    } catch {
      selecting.current = false;
      preserveQueryAfterFailedSelection.current = true;
      setError('Unable to switch to the selected group');
    }
  };

  return (
    <div className="global-search">
      <ComboBox
        allowsEmptyCollection
        defaultFilter={() => true}
        inputValue={query}
        menuTrigger="focus"
        onInputChange={loadResults}
        onSelectionChange={(key) => void selectResult(key)}
        selectedKey={null}
      >
        <Label className="sr-only">Search users, groups, and policies</Label>
        <ComboBox.InputGroup>
          <Search aria-hidden="true" size={16} />
          <Input placeholder="Search" />
        </ComboBox.InputGroup>
        <ComboBox.Popover className="global-search-popover">
          {error ? <p className="global-search-error" role="alert">{error}</p> : null}
          {results.length > 0 ? (
            <ListBox
              aria-label="Search results"
              className="global-search-results"
              selectionMode="single"
            >
              {groups.map(({ kind, label }) => {
                const items = results.filter((item) => item.kind === kind);
                if (items.length === 0) return null;
                return (
                  <ListBoxSection key={kind} id={kind}>
                    <Header><h2 className="global-search-results__heading">{label}</h2></Header>
                    {items.map((item) => (
                      <ListBoxItem key={resultKey(item)} id={resultKey(item)} aria-label={`${item.title}, ${item.subtitle}`} textValue={item.title}>
                        <div className="global-search-result">
                          <strong>{item.title}</strong>
                          <span>{item.subtitle}</span>
                        </div>
                      </ListBoxItem>
                    ))}
                  </ListBoxSection>
                );
              })}
            </ListBox>
          ) : null}
        </ComboBox.Popover>
      </ComboBox>
    </div>
  );
}

function resultKey(result: SearchResult): string {
  return `${result.kind}:${result.id}`;
}
