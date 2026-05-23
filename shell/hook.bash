# Chronicle — developer work journal
# Do not edit this block manually. Managed by `chronicle init`.
# chronicle:hook:start
_chronicle_preexec() {
  if [ "$BASH_COMMAND" != "_chronicle_precmd" ]; then
    _chronicle_cmd_start=$(date +%s%3N 2>/dev/null || echo 0)
    _chronicle_last_cmd="$BASH_COMMAND"
  fi
}

_chronicle_precmd() {
  local exit_code=$?
  if [[ -n "$_chronicle_last_cmd" ]]; then
    local now
    now=$(date +%s%3N 2>/dev/null || echo 0)
    local duration=$(( now - _chronicle_cmd_start ))
    chronicle _capture \
      --cmd "$_chronicle_last_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      --duration "$duration" \
      2>/dev/null &
    _chronicle_last_cmd=""
  fi
}

trap '_chronicle_preexec' DEBUG
PROMPT_COMMAND="_chronicle_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
# chronicle:hook:end
