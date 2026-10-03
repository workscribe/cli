export interface CompletionCommand {
  name: string
  description: string
}

export function bashCompletion(commands: CompletionCommand[]): string {
  const names = commands.map((command) => command.name).join(' ')
  return `\
_workscribe_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="${names}"
  case "$prev" in
    completions) COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") ); return ;;
    config)      COMPREPLY=( $(compgen -W "get set list" -- "$cur") ); return ;;
    profile)     COMPREPLY=( $(compgen -W "list add remove update detect suggest" -- "$cur") ); return ;;
  esac
  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _workscribe_completion workscribe`
}

export function zshCompletion(commands: CompletionCommand[]): string {
  const commandList = commands.map((command) => `    '${command.name}:${command.description}'`).join('\n')
  return `\
#compdef workscribe
_workscribe() {
  local state
  _arguments '1: :->command' '*: :->args'
  case $state in
    command)
      local -a commands
      commands=(
${commandList}
      )
      _describe 'command' commands
      ;;
    args)
      case $words[2] in
        completions) local -a shells; shells=('bash' 'zsh' 'fish'); _describe 'shell' shells ;;
        config)      local -a sub; sub=('get:Get a value' 'set:Set a value' 'list:List all values'); _describe 'subcommand' sub ;;
        profile)     local -a sub; sub=('list' 'add' 'remove' 'update' 'detect' 'suggest'); _describe 'subcommand' sub ;;
      esac
      ;;
  esac
}
compdef _workscribe workscribe`
}

export function fishCompletion(commands: CompletionCommand[]): string {
  const lines = [
    'complete -c workscribe -f',
    ...commands.map(
      (command) =>
        `complete -c workscribe -n "__fish_use_subcommand" -a ${command.name.padEnd(12)} -d "${command.description}"`
    ),
    'complete -c workscribe -n "__fish_seen_subcommand_from completions" -a "bash zsh fish"',
    'complete -c workscribe -n "__fish_seen_subcommand_from config"      -a "get set list"',
    'complete -c workscribe -n "__fish_seen_subcommand_from profile"     -a "list add remove update detect suggest"',
  ]
  return lines.join('\n')
}
