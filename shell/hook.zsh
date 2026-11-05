# Workscribe — developer work journal
# Do not edit this block manually. Managed by `workscribe init`.
# workscribe:hook:start
# workscribe:hook-version 2
# $EPOCHREALTIME exists only once zsh/datetime is loaded — plain zsh doesn't load it
zmodload zsh/datetime 2>/dev/null

_workscribe_preexec() {
  _workscribe_cmd_start=$EPOCHREALTIME
  _workscribe_cmd="$1"
  _workscribe_git_before=$(git rev-parse HEAD 2>/dev/null || echo "")
}

_workscribe_precmd() {
  local exit_code=$?
  command -v workscribe > /dev/null 2>&1 || return 0
  if [[ -n "$_workscribe_cmd" ]]; then
    # Optional flags as an array: zsh doesn't word-split ${x:+--flag "$x"}, which would pass "--flag value" as one
    # argument. And the command is captured even when it can't be timed.
    local -a _workscribe_args
    if [[ -n "$_workscribe_cmd_start" && -n "$EPOCHREALTIME" ]]; then
      local _raw_ms=$(( (EPOCHREALTIME - _workscribe_cmd_start) * 1000 ))
      _workscribe_args+=(--duration "${_raw_ms%%.*}")
    fi
    [[ -n "$_workscribe_git_before" ]] && _workscribe_args+=(--git-before "$_workscribe_git_before")
    command workscribe _capture \
      --cmd "$_workscribe_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      "${_workscribe_args[@]}" \
      > /dev/null 2>&1 &!
    _workscribe_cmd=""
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

autoload -Uz add-zsh-hook
add-zsh-hook preexec _workscribe_preexec
add-zsh-hook precmd _workscribe_precmd
# workscribe:hook:end
