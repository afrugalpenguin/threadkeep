import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DecisionRow, ShownEvent, ShownSession } from '@hansard/core';
import { api } from '../api.js';
import { navigate } from '../app.js';
import { buildHash, type Params } from '../lib/route.js';
import { filesUpTo, groupTurns, turnOfEvent } from '../lib/turns.js';

// Mirrors core's TOOL_OUTPUT_SEPARATOR; the client only needs the summary half.
const OUTPUT_SEPARATOR = '\n--- output ---\n';

const when = (ts: string | null) => (ts ? new Date(ts).toLocaleString() : '');
const basename = (dir: string | null) => (dir ? (dir.split(/[\\/]/).filter(Boolean).pop() ?? dir) : '');

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

function EventView({ event, flash }: { event: ShownEvent; flash: boolean }) {
  const cls = flash ? 'event flash' : 'event';
  if (event.kind === 'tool') {
    const summary = event.content.split(OUTPUT_SEPARATOR)[0] ?? '';
    return (
      <details class={`${cls} tool`} id={`event-${event.id}`}>
        <summary>
          <strong>{event.tool_name ?? 'tool'}</strong> {summary}
        </summary>
        {event.tool_input && <pre>{event.tool_input}</pre>}
        {event.tool_output && <pre>{event.tool_output}</pre>}
      </details>
    );
  }
  if (event.kind === 'thinking') {
    return (
      <div class={cls} id={`event-${event.id}`}>
        <div class="role">thinking</div>
        <pre class="content thinking">{event.content}</pre>
      </div>
    );
  }
  return (
    <div class={`${cls} role-${event.role}`} id={`event-${event.id}`}>
      <div class="role">
        {event.role} <span class="muted">{when(event.timestamp)}</span>
      </div>
      <pre class="content">{event.content}</pre>
    </div>
  );
}

export function ReplayView({ id, params }: { id: string; params: Params }) {
  const [data, setData] = useState<ShownSession | null>(null);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(0);
  const latest = useRef(0);
  const placed = useRef(false);
  const thinking = params.thinking === 'true';
  const eventId = params.event ?? '';

  useEffect(() => {
    const ticket = ++latest.current;
    setError('');
    api.session(id, { thinking: thinking ? 'true' : '', expandTools: 'true' }).then(
      (found) => {
        if (ticket !== latest.current) return;
        setData(found);
        const turns = groupTurns(found.events);
        // First load lands on the linked event; later reloads (thinking toggle) keep the position.
        setCurrent((prev) => (placed.current ? Math.min(prev, Math.max(0, turns.length - 1)) : turnOfEvent(turns, eventId)));
        placed.current = true;
      },
      (e: Error) => {
        if (ticket === latest.current) setError(e.message);
      },
    );
  }, [id, thinking]);

  useEffect(() => {
    api.decisions({ session: id }).then(setDecisions, () => setDecisions([]));
  }, [id]);

  const turns = useMemo(() => groupTurns(data?.events ?? []), [data]);
  const last = Math.max(0, turns.length - 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTyping(e.target)) return;
      if (e.key === 'j') setCurrent((c) => Math.min(c + 1, last));
      else if (e.key === 'k') setCurrent((c) => Math.max(c - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [last]);

  // Skip the very first position unless the link pointed at something, so the header stays in view.
  useEffect(() => {
    if (turns.length === 0 || (current === 0 && !eventId)) return;
    document.getElementById(`turn-${current}`)?.scrollIntoView({ block: 'start' });
  }, [current, turns]);

  const setThinking = (on: boolean) => navigate({ view: 'session', id, params: { ...params, thinking: on ? 'true' : '' } });

  if (error) {
    return (
      <section>
        <p class="error" role="alert">
          {error}
        </p>
        <a href={buildHash({ view: 'sessions', params: {} })}>Back to sessions</a>
      </section>
    );
  }
  if (!data) return <p class="muted">loading</p>;

  const { session } = data;
  const files = filesUpTo(turns, current);

  return (
    <section>
      <header class="replay-head">
        <h1>{session.title || session.id}</h1>
        <p class="muted">
          {basename(session.project_dir)} | {session.source} | {session.machine_id.slice(0, 8)} | {when(session.started_at)} | {session.event_count}{' '}
          events
        </p>
        <div class="controls">
          <label class="check">
            <input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.currentTarget.checked)} />
            Show thinking
          </label>
          <span>
            turn {turns.length === 0 ? 0 : current + 1} of {turns.length}
          </span>
          <input
            type="range"
            aria-label="Turn"
            min={0}
            max={last}
            value={current}
            disabled={turns.length < 2}
            onInput={(e) => setCurrent(Number(e.currentTarget.value))}
          />
          <span class="muted">j / k to step</span>
        </div>
      </header>
      <div class="replay">
        <div class="turns">
          {turns.map((turn) => (
            <div key={turn.index} id={`turn-${turn.index}`} class={turn.index === current ? 'turn current' : 'turn'}>
              {turn.events.map((event) => (
                <EventView key={event.id} event={event} flash={event.id === eventId} />
              ))}
            </div>
          ))}
          {turns.length === 0 && <p class="empty">no events in this session</p>}
        </div>
        <aside class="side">
          <h2>Files touched</h2>
          {files.length === 0 && <p class="muted">none yet</p>}
          <ul class="files">
            {files.map((f) => (
              <li key={f.file}>
                <button type="button" onClick={() => setCurrent(f.firstTurn)}>
                  {f.file} <span class="muted">x{f.count}</span>
                </button>
              </li>
            ))}
          </ul>
          <h2>Decisions</h2>
          {decisions.length === 0 && <p class="muted">none recorded</p>}
          <ul class="decisions">
            {decisions.map((d) => (
              <li key={d.id}>
                <span class={`badge badge-${d.status}`}>{d.status}</span> {d.statement}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
