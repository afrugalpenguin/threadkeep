// Fail closed until the pattern set lands: nothing is stored unredacted.
export function redactText(text: string | null): string | null {
  if (text === null || text === '') return text;
  return '[REDACTED:pending]';
}
