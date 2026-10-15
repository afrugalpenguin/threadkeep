import { useEffect, useRef, useState } from 'preact/hooks';
import type { SearchHit } from '@hansard/core';
import { api, pick } from '../api.js';
import { navigate } from '../app.js';
import { segments } from '../lib/highlight.js';
import type { Params } from '../lib/route.js';
import { Filters } from './filters.js';

const KEYS = ['q', 'source', 'machine', 'project', 'since', 'sort', 'role', 'thinking'];

interface Group {
  id: string;
  title: string | null;
  hits: SearchHit[];
}

// Groups hits by session, keeping the order in which sessions first appear.
function group(hits: SearchHit[]): Group[] {
  const groups = new Map<string, Group>();
  for (const hit of hits) {
    const existing = groups.get(hit.session_id);
    if (existing) existing.hits.push(hit);
    else groups.set(hit.session_id, { id: hit.session_id, title: hit.title, hits: [hit] });
  }
  return [...groups.values()];
}

export function SearchView({ params }: { params: Params }) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const query = pick(params, KEYS);
  const key = JSON.stringify(query);

  useEffect(() => {
    const ticket = ++latest.current;
    setError('');
    if (!query.q) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.search(query).then(
      (found) => {
        if (ticket !== latest.current) return;
        setHits(found);
        setLoading(false);
      },
      (e: Error) => {
        if (ticket !== latest.current) return;
        setHits([]);
        setError(e.message);
        setLoading(false);
      },
    );
  }, [key]);

  return (
    <section>
      <h1>Search</h1>
      <input
        type="search"
        class="query"
        aria-label="Search query"
        placeholder="search conversations, press Enter"
        value={params.q ?? ''}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate({ view: 'search', params: { ...params, q: e.currentTarget.value.trim() } });
        }}
      />
      <Filters params={params} extra onChange={(p) => navigate({ view: 'search', params: p })} />
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p class="muted">searching</p>}
      {!loading && !error && query.q && hits.length === 0 && <p class="empty">no matches</p>}
      {group(hits).map((g) => (
        <div class="hit-group" key={g.id}>
          <h2>{g.title || g.id}</h2>
          <ul class="hits">
            {g.hits.map((hit) => (
              <li key={hit.event_id}>
                <button
                  type="button"
                  class="hit"
                  onClick={() => navigate({ view: 'session', id: hit.session_id, params: { event: hit.event_id } })}
                >
                  <span class="muted">
                    {hit.role}
                    {hit.timestamp ? ` ${new Date(hit.timestamp).toLocaleString()}` : ''}
                  </span>
                  <span class="snippet">{segments(hit.snippet).map((s) => (s.hit ? <mark>{s.text}</mark> : s.text))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
