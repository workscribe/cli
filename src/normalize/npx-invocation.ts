// What `npx` runs, once its own flags are out of the way. Pure.

// npx's own flags that take no value: `npx --no-install vitest` runs vitest. Only these. A flag that takes a value
// (`-p pkg`, `-c "cmd"`, `--registry url`) can't be skipped without reading the value, so such a command is left as
// it is rather than guessed at.
const NPX_BOOLEAN_FLAGS =
  /^npx\s+(?:(?:-y|--yes|--no|--no-yes|--no-install|-q|--quiet|--prefer-offline|--offline|--ignore-existing)\s+)+/

/** `npx --no-install vitest run` as `npx vitest run`, so the rules see the tool; anything else as it was. */
export function withoutNpxBooleanFlags(command: string): string {
  return command.replace(NPX_BOOLEAN_FLAGS, 'npx ')
}
