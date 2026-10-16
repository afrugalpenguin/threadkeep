// Import sources can be exported again later with edited messages; this lets the newest edit win
// regardless of the order exports are ingested in.
export const sourceUpdatedAt = `
alter table events add column source_updated_at text;
alter table sessions add column source_updated_at text;
`;
