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
  if [[ -n "$_workscribe_cmd" ]]; then
    local duration_ms=$(( int(($EPOCHREALTIME - $_workscribe_cmd_start) * 1000) ))
    workscribe _capture \
      --cmd "$_workscribe_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      --duration "$duration_ms" \
      ${_workscribe_git_before:+--git-before "$_workscribe_git_before"} \
      2>/dev/null &!
    _workscribe_cmd=""
    _workscribe_git_before=""
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _workscribe_preexec
add-zsh-hook precmd _workscribe_precmd
# workscribe:hook:end
