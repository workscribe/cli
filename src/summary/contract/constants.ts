/**
 * Versions of the `--json` documents read by coding agents and other tools, one per document. Fields may be added
 * within a version; renaming, removing or retyping a field — or changing what it means — bumps that document's
 * version. Tests pin the key sets.
 */
/** 2: sessions are project threads inside work blocks (WOR-147). */
export const SESSIONS_SCHEMA_VERSION = 2
export const EVENTS_SCHEMA_VERSION = 1
export const HISTORY_SCHEMA_VERSION = 1
