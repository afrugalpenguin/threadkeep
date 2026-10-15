import { useEffect, useRef, useState } from 'preact/hooks';
import type { SessionRow } from '@hansard/core';
import { api, pick } from '../api.js';
import { buildHash, type Params } from '../lib/route.js';
import { navigate } from '../lib/nav.js';
import { SESSION_SORTS, withValidSort } from '../lib/sorts.js';
import { Filters } from './filters.js';

const PAGE = 50;
const FILTER_KEYS = ['source', 'machine', 'project', 'since', 'sort'];

const basename = (dir: string | null) => (dir ? (dir.split(/[\\/]/).filter(Boolean).pop() ?? dir) : '');
const when = (ts: string | null) => (ts ? new Date(ts).toLocaleString() : '');

export function SessionsView({ params }: { params: Params }) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const filters = withValidSort(pick(params, FILTER_KEYS), SESSION_SORTS);
  const key = JSON.stringify(filters);

  // A newer request bumps the ticket so an older response is ignored when it lands.
  const load = (offset: number) => {
    const ticket = ++latest.current;
    setLoading(true);
    setError('');
    api.sessions({ ...filters, limit: String(PAGE), offset: String(offset) }).then(
      (page) => {
        if (ticket !== latest.current) return;
        setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
        setMore(page.length === PAGE);
        setLoading(false);
      },
      (e: Error) => {
        if (ticket !== latest.current) return;
        setError(e.message);
        setLoading(false);
      },
    );
  };

  useEffect(() => {
    setRows([]);
    setMore(false);
    load(0);
  }, [key]);

  return (
    <section>
      <h1>Sessions</h1>
      <Filters params={params} onChange={(p) => navigate({ view: 'sessions', params: p })} />
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Title</th>
              <th>Project</th>
              <th>Source</th>
              <th>Machine</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} class="row-link" onClick={() => navigate({ view: 'session', id: r.id, params: {} })}>
                <td>{when(r.started_at)}</td>
                <td>
                  <a href={buildHash({ view: 'session', id: r.id, params: {} })} onClick={(e) => e.stopPropagation()}>
                    {r.title || r.id}
                  </a>
                </td>
                <td>{basename(r.project_dir)}</td>
                <td>{r.source}</td>
                <td>{r.machine_id.slice(0, 8)}</td>
                <td>{r.event_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !error && rows.length === 0 && <p class="empty">no sessions found</p>}
      {loading && (
        <p class="muted" role="status">
          loading
        </p>
      )}
      {more && !loading && (
        <button type="button" onClick={() => load(rows.length)}>
          Load more
        </button>
      )}
    </section>
  );
}
