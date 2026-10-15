import { useEffect, useState } from 'preact/hooks';
import type { Facets } from '@hansard/core';
import { api } from '../api.js';
import type { Params } from '../lib/route.js';

interface Props {
  params: Params;
  onChange: (params: Params) => void;
  extra?: boolean;
}

export function Filters({ params, onChange, extra = false }: Props) {
  const [facets, setFacets] = useState<Facets | null>(null);
  useEffect(() => {
    api.facets().then(setFacets, () => setFacets(null));
  }, []);

  const set = (key: string, value: string) => onChange({ ...params, [key]: value });
  // Text inputs commit on blur; Enter just blurs so there is one commit path.
  const commitText = (key: string) => (e: Event) => {
    const value = (e.currentTarget as HTMLInputElement).value.trim();
    if (value !== (params[key] ?? '')) set(key, value);
  };
  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };
  const sorts = extra ? ['rank', 'time'] : ['time', 'project', 'source', 'length'];

  return (
    <div class="filters">
      <label>
        Source
        <select value={params.source ?? ''} onChange={(e) => set('source', e.currentTarget.value)}>
          <option value="">all</option>
          {facets?.sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Machine
        <select value={params.machine ?? ''} onChange={(e) => set('machine', e.currentTarget.value)}>
          <option value="">all</option>
          {facets?.machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label ?? m.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <input type="text" list="project-list" value={params.project ?? ''} onBlur={commitText('project')} onKeyDown={onEnter} />
        <datalist id="project-list">
          {facets?.projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label>
        Since
        <input type="text" placeholder="7d or 2026-10-01" value={params.since ?? ''} onBlur={commitText('since')} onKeyDown={onEnter} />
      </label>
      <label>
        Sort
        <select value={params.sort ?? sorts[0]} onChange={(e) => set('sort', e.currentTarget.value)}>
          {sorts.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {extra && (
        <>
          <label>
            Role
            <select value={params.role ?? ''} onChange={(e) => set('role', e.currentTarget.value)}>
              <option value="">any</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
              <option value="tool">tool</option>
              <option value="system">system</option>
            </select>
          </label>
          <label class="check">
            <input type="checkbox" checked={params.thinking === 'true'} onChange={(e) => set('thinking', e.currentTarget.checked ? 'true' : '')} />
            Include thinking
          </label>
        </>
      )}
    </div>
  );
}
