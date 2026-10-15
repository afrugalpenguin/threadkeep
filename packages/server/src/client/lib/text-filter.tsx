import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';

type Props = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onInput' | 'onBlur' | 'onKeyDown'> & {
  value: string;
  onCommit: (value: string) => void;
};

// Keeps typed text in a local draft so re-renders never clobber it; commits on blur or Enter.
export function TextFilter({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      {...rest}
      value={draft}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
