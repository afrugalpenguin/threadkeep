export interface TurnEvent {
  id: string;
  role: string;
  kind: string;
  files_touched: string[];
}

export interface Turn<E extends TurnEvent> {
  index: number;
  events: E[];
}

// A turn starts at each user text message; anything before the first one is turn 0.
export function groupTurns<E extends TurnEvent>(events: E[]): Turn<E>[] {
  const turns: Turn<E>[] = [];
  for (const event of events) {
    const last = turns[turns.length - 1];
    if (!last || (event.role === 'user' && event.kind === 'text')) turns.push({ index: turns.length, events: [event] });
    else last.events.push(event);
  }
  return turns;
}

export function turnOfEvent(turns: Turn<TurnEvent>[], eventId: string): number {
  const found = turns.find((t) => t.events.some((e) => e.id === eventId));
  return found?.index ?? 0;
}

export interface FileTouch {
  file: string;
  count: number;
  firstTurn: number;
}

export function filesUpTo(turns: Turn<TurnEvent>[], upTo: number): FileTouch[] {
  const files = new Map<string, FileTouch>();
  for (const turn of turns.slice(0, upTo + 1)) {
    for (const event of turn.events) {
      for (const file of new Set(event.files_touched)) {
        const seen = files.get(file);
        if (seen) seen.count += 1;
        else files.set(file, { file, count: 1, firstTurn: turn.index });
      }
    }
  }
  return [...files.values()].sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}
