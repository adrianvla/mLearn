import { ComboBox, Input, Label } from '@heroui/react';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClient } from '../api/client';

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
  const requestId = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadResults = (value: string) => {
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

  const selectResult = (key: React.Key | null) => {
    if (key === null) return;
    const result = results.find((item) => resultKey(item) === key);
    if (!result) return;
    setQuery('');
    setResults([]);
    setError(null);
    navigate(result.href);
  };

  return (
    <ComboBox
      className="global-search"
      inputValue={query}
      menuTrigger="focus"
      onInputChange={loadResults}
    >
      <Label className="sr-only">Search users, groups, and policies</Label>
      <ComboBox.InputGroup>
        <Search aria-hidden="true" size={16} />
        <Input placeholder="Search" />
      </ComboBox.InputGroup>
      {error ? <p role="alert">{error}</p> : null}
      {!error && results.length > 0 ? (
        <div className="global-search-overlay">
          <div aria-label="Search results" role="listbox">
            {groups.map(({ kind, label }) => {
              const items = results.filter((item) => item.kind === kind);
              if (items.length === 0) return null;
              return (
                <section key={kind}>
                  <h2>{label}</h2>
                  {items.map((item) => (
                    <button key={resultKey(item)} aria-label={`${item.title}, ${item.subtitle}`} onClick={() => selectResult(resultKey(item))} role="option" type="button">
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.subtitle}</span>
                      </div>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </ComboBox>
  );
}

function resultKey(result: SearchResult): string {
  return `${result.kind}:${result.id}`;
}
