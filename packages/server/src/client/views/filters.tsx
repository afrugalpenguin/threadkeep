import { useEffect, useState } from 'preact/hooks';
import type { Facets } from 'threadkeep-core';
import { api } from '../api.js';
import type { Params } from '../lib/route.js';
import { SEARCH_SORTS, SESSION_SORTS, effectiveSort } from '../lib/sorts.js';
import { TextFilter } from '../lib/text-filter.js';

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
  const sorts = extra ? SEARCH_SORTS : SESSION_SORTS;

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
        <TextFilter list="project-list" value={params.project ?? ''} onCommit={(v) => set('project', v)} />
        <datalist id="project-list">
          {facets?.projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label>
        Since
        <TextFilter placeholder="7d or 2026-10-01" value={params.since ?? ''} onCommit={(v) => set('since', v)} />
      </label>
      <label>
        Sort
        <select value={effectiveSort(params.sort, sorts)} onChange={(e) => set('sort', e.currentTarget.value)}>
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
