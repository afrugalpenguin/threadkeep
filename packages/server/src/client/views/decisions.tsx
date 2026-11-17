import { useEffect, useRef, useState } from 'preact/hooks';
import type { DecisionRow } from 'threadkeep-core';
import { api, pick } from '../api.js';
import { buildHash, type Params } from '../lib/route.js';
import { navigate } from '../lib/nav.js';

export function DecisionsView({ params }: { params: Params }) {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const latest = useRef(0);
  const status = params.status ?? '';

  const load = (): Promise<void> => {
    const ticket = ++latest.current;
    return api.decisions(pick(params, ['status'])).then(
      (found) => {
        if (ticket !== latest.current) return;
        setRows(found);
        setLoaded(true);
      },
      (e: Error) => {
        if (ticket !== latest.current) return;
        setError(e.message);
        setLoaded(true);
      },
    );
  };

  useEffect(() => {
    setLoaded(false);
    setError('');
    load();
  }, [status]);

  const decide = async (id: string, next: 'confirmed' | 'dismissed') => {
    setBusy(id);
    setError('');
    try {
      await api.setDecision(id, next);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <section>
      <h1>Decisions</h1>
      <div class="filters">
        <label>
          Status
          <select value={status} onChange={(e) => navigate({ view: 'decisions', params: { ...params, status: e.currentTarget.value } })}>
            <option value="">all</option>
            <option value="proposed">proposed</option>
            <option value="confirmed">confirmed</option>
            <option value="dismissed">dismissed</option>
          </select>
        </label>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {loaded && !error && rows.length === 0 && <p class="empty">no decisions recorded yet</p>}
      <ul class="decisions">
        {rows.map((d) => (
          <li key={d.id} class="decision">
            <div class="decision-head">
              <span class={`badge badge-${d.status}`}>{d.status}</span>
              <span class="muted">{d.created_at ? new Date(d.created_at).toLocaleString() : ''}</span>
            </div>
            <p class="statement">{d.statement}</p>
            {d.rationale && (
              <p>
                <strong>Rationale:</strong> {d.rationale}
              </p>
            )}
            {d.alternatives && (
              <p>
                <strong>Alternatives:</strong> {d.alternatives}
              </p>
            )}
            <p>
              <a href={buildHash({ view: 'session', id: d.session_id, params: d.event_id ? { event: d.event_id } : {} })}>
                {d.session_title || d.session_id}
              </a>
            </p>
            {d.status === 'proposed' && (
              <div class="actions">
                <button type="button" disabled={busy === d.id} onClick={() => decide(d.id, 'confirmed')}>
                  Confirm
                </button>
                <button type="button" disabled={busy === d.id} onClick={() => decide(d.id, 'dismissed')}>
                  Dismiss
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
