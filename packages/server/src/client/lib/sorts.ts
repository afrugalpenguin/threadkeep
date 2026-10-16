export const SESSION_SORTS = ['time', 'project', 'source', 'length'];
export const SEARCH_SORTS = ['rank', 'time'];

// The sort to show: the requested one if this view offers it, else the view's first option.
export function effectiveSort(sort: string | undefined, options: string[]): string {
  return sort !== undefined && options.includes(sort) ? sort : (options[0] as string);
}

// Drops an unsupported sort value so it is never forwarded to the API.
export function withValidSort(params: Record<string, string>, options: string[]): Record<string, string> {
  const { sort, ...rest } = params;
  return sort !== undefined && options.includes(sort) ? { ...rest, sort } : rest;
}
