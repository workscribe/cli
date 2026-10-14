// Per-file dedup window for IDE file-save events.
// Prevents duplicate captures when an IDE auto-saves the same file repeatedly.
export const IDE_DEDUP_WINDOW_MS = 30_000

// task_run can double-capture: a shell task running in a hooked terminal
// fires both this generic event and a richer shell-sourced one, with no
// shared ID linking them. Shell events land first (precmd fires as the
// command returns), so a short window here catches the same real action.
export const TASK_RUN_DEDUP_WINDOW_MS = 5_000

// Valid event type strings sent by IDE integrations via `workscribe _capture --type <type>`.
export const IDE_EVENT_TYPES = new Set(['code_edit', 'debug_start', 'debug_end', 'task_run'])

export function isIdeEventType(type: string): boolean {
  return IDE_EVENT_TYPES.has(type)
}
