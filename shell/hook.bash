# Workscribe — developer work journal
# Do not edit this block manually. Managed by `workscribe init`.
# workscribe:hook:start
_workscribe_preexec() {
  if [ "$BASH_COMMAND" != "_workscribe_precmd" ]; then
    _workscribe_cmd_start=$(date +%s%3N 2>/dev/null || echo 0)
    _workscribe_last_cmd="$BASH_COMMAND"
    _workscribe_git_before=$(git rev-parse HEAD 2>/dev/null || echo "")
  fi
}

_workscribe_precmd() {
  local exit_code=$?
  command -v workscribe &>/dev/null || return 0
  if [[ -n "$_workscribe_last_cmd" ]]; then
    local now
    now=$(date +%s%3N 2>/dev/null || echo 0)
    local duration=$(( now - _workscribe_cmd_start ))
    command workscribe _capture \
      --cmd "$_workscribe_last_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      --duration "$duration" \
      ${_workscribe_git_before:+--git-before "$_workscribe_git_before"} \
      > /dev/null 2>&1 &
    _workscribe_last_cmd=""
    _workscribe_git_before=""
  fi
  # Skip the alert check on the first precmd: it fires before the shell has
  # finished initializing, and that output gets mistaken for a startup error.
  if [[ -n "$_workscribe_primed" ]] && [[ -f "$HOME/.workscribe/alerts.pending" ]]; then
    command workscribe alerts --check
  fi
  _workscribe_primed=1
}

trap '_workscribe_preexec' DEBUG
PROMPT_COMMAND="_workscribe_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
# workscribe:hook:end
