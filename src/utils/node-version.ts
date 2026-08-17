export function assertNodeVersion(nodeVersion: string): void {
  const major = Number(nodeVersion.split('.')[0])
  if (major < 22) {
    process.stderr.write(
      `workscribe requires Node.js 22 or later (you have v${nodeVersion}).\n` +
        `Upgrade at https://nodejs.org or via your version manager:\n` +
        `  nvm install 22 && nvm use 22\n`
    )
    process.exit(1)
  }
}
