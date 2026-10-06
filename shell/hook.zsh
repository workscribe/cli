# Workscribe — developer work journal
# Do not edit this block manually. Managed by `workscribe init`.
# workscribe:hook:start
_workscribe_preexec() {
  _workscribe_cmd_start=$EPOCHREALTIME
  _workscribe_cmd="$1"
  _workscribe_git_before=$(git rev-parse HEAD 2>/dev/null || echo "")
}

_workscribe_precmd() {
  local exit_code=$?
  command -v workscribe > /dev/null 2>&1 || return 0
  if [[ -n "$_workscribe_cmd" ]]; then
    local _raw_ms=$(( ($EPOCHREALTIME - $_workscribe_cmd_start) * 1000 ))
    local duration_ms=${_raw_ms%%.*}
    command workscribe _capture \
      --cmd "$_workscribe_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      --duration "$duration_ms" \
      ${_workscribe_git_before:+--git-before "$_workscribe_git_before"} \
      > /dev/null 2>&1 &!
    _workscribe_cmd=""
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
