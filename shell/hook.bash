# Workscribe — developer work journal
# Do not edit this block manually. Managed by `workscribe init`.
# workscribe:hook:start
# workscribe:hook-version 2
# Now in milliseconds, or nothing: bash 5's $EPOCHREALTIME, else `date +%s` (macOS's bash 3.2 has no $EPOCHREALTIME,
# and its BSD date has no %N)
_workscribe_now_ms() {
  if [[ -n "${EPOCHREALTIME:-}" ]]; then
    local micros=${EPOCHREALTIME//[.,]/}
    [[ $micros =~ ^[0-9]+$ ]] && echo $(( 10#$micros / 1000 ))
    return 0
  fi
  local seconds
  seconds=$(date +%s 2>/dev/null)
  [[ $seconds =~ ^[0-9]+$ ]] && echo $(( seconds * 1000 ))
  return 0
}

_workscribe_preexec() {
  # The DEBUG trap also fires for the rest of the rc file — nothing before the first prompt is the user's command
  [[ -n "${_workscribe_primed:-}" ]] || return 0
  if [ "$BASH_COMMAND" != "_workscribe_precmd" ]; then
    _workscribe_cmd_start=$(_workscribe_now_ms)
    _workscribe_last_cmd="$BASH_COMMAND"
    _workscribe_git_before=$(git rev-parse HEAD 2>/dev/null || echo "")
  fi
}

_workscribe_precmd() {
  local exit_code=$?
  command -v workscribe &>/dev/null || return 0
  if [[ -n "$_workscribe_last_cmd" ]]; then
    # The command is captured even when it can't be timed: no duration rather than no event
    local now duration=""
    now=$(_workscribe_now_ms)
    if [[ $now =~ ^[0-9]+$ && $_workscribe_cmd_start =~ ^[0-9]+$ ]]; then
      duration=$(( now - _workscribe_cmd_start ))
    fi
    command workscribe _capture \
      --cmd "$_workscribe_last_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      ${duration:+--duration "$duration"} \
      ${_workscribe_git_before:+--git-before "$_workscribe_git_before"} \
      > /dev/null 2>&1 &
    _workscribe_last_cmd=""
    _workscribe_cmd_start=""
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
