import { basename, type MachineInfo } from '@hansard/core';

export const shortId = (id: string): string => id.slice(0, 8);

export function formatTime(ts: string | null): string {
  return ts ? ts.slice(0, 16).replace('T', ' ') : '-';
}

export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const projectName = (dir: string | null): string => (dir ? basename(dir) || '-' : '-');

export function machineName(machines: MachineInfo[], id: string): string {
  const found = machines.find((m) => m.id === id);
  return found?.label ?? shortId(id);
}

export const jsonOut = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
