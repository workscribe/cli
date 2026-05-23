# Chronicle — developer work journal
# Do not edit this block manually. Managed by `chronicle init`.
# chronicle:hook:start
_chronicle_preexec() {
  _chronicle_cmd_start=$EPOCHREALTIME
  _chronicle_cmd="$1"
}

_chronicle_precmd() {
  local exit_code=$?
  if [[ -n "$_chronicle_cmd" ]]; then
    local duration_ms=$(( int(($EPOCHREALTIME - $_chronicle_cmd_start) * 1000) ))
    chronicle _capture \
      --cmd "$_chronicle_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      --duration "$duration_ms" \
      2>/dev/null &!
    _chronicle_cmd=""
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _chronicle_preexec
add-zsh-hook precmd _chronicle_precmd
# chronicle:hook:end
