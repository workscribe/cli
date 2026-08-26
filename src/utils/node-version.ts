export type VersionManager = 'nvm' | 'volta' | 'fnm' | 'mise' | 'asdf' | 'nodenv'

export function detectVersionManager(): VersionManager | null {
  if (process.env.NVM_DIR) return 'nvm'
  if (process.env.VOLTA_HOME) return 'volta'
  if (process.env.FNM_DIR) return 'fnm'
  if (process.env.MISE_DATA_DIR || process.env.MISE_SHELL) return 'mise'
  if (process.env.ASDF_DIR || process.env.ASDF_DATA_DIR) return 'asdf'
  if (process.env.NODENV_ROOT) return 'nodenv'
  return null
}

const UPGRADE_COMMANDS: Record<VersionManager, string> = {
  nvm: 'nvm install 22 && nvm use 22',
  volta: 'volta install node@22',
  fnm: 'fnm install 22 && fnm use 22',
  mise: 'mise use --global node@22',
  asdf: 'asdf install nodejs 22 && asdf global nodejs 22',
  nodenv: 'nodenv install 22 && nodenv global 22',
}

export function assertNodeVersion(nodeVersion: string): void {
  const major = Number(nodeVersion.split('.')[0])
  if (major < 22) {
    const manager = detectVersionManager()
    const upgradeHint = manager
      ? `Upgrade with ${manager}:\n  ${UPGRADE_COMMANDS[manager]}`
      : 'Download the latest version from https://nodejs.org'
    process.stderr.write(`workscribe requires Node.js 22 or later (you have v${nodeVersion}).\n\n${upgradeHint}\n`)
    process.exit(1)
  }
}
