import { useEffect, useState } from 'preact/hooks';
import { captureTokenFromLocation, currentToken, onTokenCleared } from './auth.js';
import { buildHash, parseHash, type Route } from './lib/route.js';
import { SessionsView } from './views/sessions.js';
import { SearchView } from './views/search.js';
import { ReplayView } from './views/replay.js';
import { DecisionsView } from './views/decisions.js';

const links: { view: 'sessions' | 'search' | 'decisions'; label: string }[] = [
  { view: 'sessions', label: 'Sessions' },
  { view: 'search', label: 'Search' },
  { view: 'decisions', label: 'Decisions' },
];

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [locked, setLocked] = useState<boolean>(() => currentToken() === '');
  useEffect(() => {
    const onChange = () => {
      if (captureTokenFromLocation()) setLocked(false);
      setRoute(parseHash(location.hash));
    };
    window.addEventListener('hashchange', onChange);
    const stop = onTokenCleared(() => setLocked(true));
    return () => {
      window.removeEventListener('hashchange', onChange);
      stop();
    };
  }, []);
  if (locked) {
    return (
      <main class="locked">
        <p>Open the link printed in your terminal by hansard ui, or run hansard ui --open.</p>
      </main>
    );
  }
  const active = route.view === 'session' ? 'sessions' : route.view;
  return (
    <div class="shell">
      <nav class="topnav">
        <strong class="brand">Hansard</strong>
        {links.map((l) => (
          <a
            key={l.view}
            href={buildHash({ view: l.view, params: {} })}
            class={l.view === active ? 'active' : ''}
            aria-current={l.view === active ? 'page' : undefined}
          >
            {l.label}
          </a>
        ))}
      </nav>
      <main>
        {route.view === 'sessions' && <SessionsView params={route.params} />}
        {route.view === 'search' && <SearchView params={route.params} />}
        {route.view === 'session' && <ReplayView key={route.id} id={route.id} params={route.params} />}
        {route.view === 'decisions' && <DecisionsView params={route.params} />}
      </main>
    </div>
  );
}
