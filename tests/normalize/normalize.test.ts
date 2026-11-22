import { describe, it, expect } from 'vitest'
import { normalizeCommand } from '../../src/normalize/patterns'

// Helper to get just the category
function category(cmd: string) {
  return normalizeCommand(cmd).category
}

// Helper to get category + metadata
function normalize(cmd: string) {
  return normalizeCommand(cmd)
}

describe('normalizeCommand', () => {
  describe('git operations', () => {
    it('classifies git commit', () => {
      expect(category('git commit -m "fix: auth bug"')).toBe('shipping')
    })

    it('extracts commit message', () => {
      const result = normalize('git commit -m "fix: auth bug"')
      expect(result.metadata.message).toBe('fix: auth bug')
    })

    it('keeps an apostrophe inside a double-quoted commit message', () => {
      expect(normalize(`git commit -m "fix: don't redirect"`).metadata.message).toBe("fix: don't redirect")
      expect(normalize(`git commit -m 'say "hi"'`).metadata.message).toBe('say "hi"')
    })

    it('takes one word for an unquoted commit message and ignores the flags after it', () => {
      expect(normalize('git commit -m wip --no-verify').metadata.message).toBe('wip')
    })

    it('classifies git commit with no message flag', () => {
      expect(category('git commit --amend')).toBe('shipping')
    })

    it('classifies git push', () => {
      expect(category('git push')).toBe('shipping')
      expect(category('git push origin main')).toBe('shipping')
    })

    it('extracts remote and branch from git push', () => {
      const result = normalize('git push origin feature/auth')
      expect(result.metadata.remote).toBe('origin')
      expect(result.metadata.branch).toBe('feature/auth')
    })

    it('skips flags when extracting remote and branch from git push', () => {
      expect(normalize('git push -u origin main').metadata).toEqual({ remote: 'origin', branch: 'main' })
      expect(normalize('git push --force-with-lease').metadata).toEqual({ remote: 'origin', branch: null })
    })

    it('classifies git pull', () => {
      expect(category('git pull')).toBe('versioning')
      expect(category('git pull origin main')).toBe('versioning')
    })

    it('classifies git fetch', () => {
      expect(category('git fetch')).toBe('versioning')
    })

    it('classifies git checkout as branch_switch', () => {
      expect(category('git checkout feature/auth')).toBe('versioning')
    })

    it('classifies git switch as branch_switch', () => {
      expect(category('git switch main')).toBe('versioning')
    })

    it('classifies git merge', () => {
      expect(category('git merge feature/auth')).toBe('shipping')
    })

    it('classifies git rebase', () => {
      expect(category('git rebase main')).toBe('shipping')
    })

    it('classifies git stash', () => {
      expect(category('git stash')).toBe('versioning')
      expect(category('git stash pop')).toBe('versioning')
    })

    it('classifies other git commands as git_other', () => {
      expect(category('git add .')).toBe('versioning')
      expect(category('git branch -a')).toBe('versioning')
    })

    it('classifies git commands that only read as exploring', () => {
      expect(normalize('git log --oneline')).toMatchObject({ category: 'exploring', metadata: { subcommand: 'log' } })
      expect(category('git diff HEAD')).toBe('exploring')
      expect(category('git show abc')).toBe('exploring')
      expect(category('git status')).toBe('exploring')
      expect(category('git branch')).toBe('exploring')
    })
  })

  describe('dependency install', () => {
    it('classifies npm install', () => {
      expect(category('npm install')).toBe('dependencies')
      expect(category('npm install axios')).toBe('dependencies')
    })

    it('extracts packages from npm install', () => {
      const result = normalize('npm install axios express')
      expect(result.metadata.tool).toBe('npm')
      expect(result.metadata.packages).toEqual(['axios', 'express'])
    })

    it('ignores flags in package extraction', () => {
      const result = normalize('npm install --save-dev vitest')
      expect(result.metadata.packages).toEqual(['vitest'])
    })

    it('takes no package from a command substitution, which the shell expands before npm sees it', () => {
      const result = normalize('npm uninstall $(cat $S/rm.txt)')

      expect(result.metadata).toEqual({ tool: 'npm', packages: [], action: 'remove' })
    })

    it('takes no package from a backtick substitution', () => {
      expect(normalize('npm install `cat pkgs.txt` zod').metadata.packages).toEqual(['zod'])
    })

    it.each(['$EXTRA', '${EXTRA}', '"$EXTRA"', '"$(echo a b)"'])('takes no package from the expansion %s', (word) => {
      expect(normalize(`npm install ${word} zod`).metadata.packages).toEqual(['zod'])
    })

    it('keeps the real package names beside a substitution', () => {
      expect(normalize('pnpm add $(cat a.txt) zod axios').metadata.packages).toEqual(['zod', 'axios'])
    })

    it('keeps a single-quoted dollar sign, which the shell does not expand', () => {
      expect(normalize("npm install '$x'").metadata.packages).toEqual(["'$x'"])
    })

    it('still reads the packages after a stray quote mark', () => {
      expect(normalize("npm install a don't b").metadata.packages).toEqual(['a', "don't", 'b'])
    })

    it('classifies npm i shorthand', () => {
      expect(category('npm i axios')).toBe('dependencies')
    })

    it('classifies yarn add', () => {
      expect(category('yarn add react')).toBe('dependencies')
      const result = normalize('yarn add react react-dom')
      expect(result.metadata.tool).toBe('yarn')
    })

    it('classifies pnpm add', () => {
      expect(category('pnpm add typescript')).toBe('dependencies')
    })

    it('classifies bun add', () => {
      const result = normalize('bun add react react-dom')
      expect(result.category).toBe('dependencies')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.packages).toEqual(['react', 'react-dom'])
    })

    it('classifies bun install', () => {
      expect(category('bun install')).toBe('dependencies')
    })

    it('classifies pip install', () => {
      const result = normalize('pip install requests flask')
      expect(result.category).toBe('dependencies')
      expect(result.metadata.tool).toBe('pip')
      expect(result.metadata.packages).toEqual(['requests', 'flask'])
    })

    it('classifies cargo add', () => {
      const result = normalize('cargo add serde')
      expect(result.category).toBe('dependencies')
      expect(result.metadata.tool).toBe('cargo')
    })

    it('classifies brew install', () => {
      expect(category('brew install jq')).toBe('dependencies')
    })

    it('classifies go get', () => {
      expect(category('go get github.com/pkg/errors')).toBe('dependencies')
    })

    it('classifies nvm as dependencies', () => {
      expect(category('nvm install v22.22.0')).toBe('dependencies')
      expect(category('nvm use 20')).toBe('dependencies')
    })

    it('classifies fnm as dependencies', () => {
      expect(category('fnm install 20')).toBe('dependencies')
    })

    it('classifies volta as dependencies', () => {
      expect(category('volta install node')).toBe('dependencies')
    })

    it('classifies rbenv as dependencies', () => {
      expect(category('rbenv install 3.2.0')).toBe('dependencies')
    })

    it('classifies pyenv as dependencies', () => {
      expect(category('pyenv global 3.11')).toBe('dependencies')
    })

    it('classifies asdf as dependencies', () => {
      expect(category('asdf install nodejs 20.0.0')).toBe('dependencies')
    })
  })

  // WOR-127: package names the summaries rely on
  describe('dependency install — package names', () => {
    it.each([
      ['pnpm install lodash', { tool: 'pnpm', packages: ['lodash'] }],
      ['pnpm i -D vitest', { tool: 'pnpm', packages: ['vitest'] }],
      ['pnpm --filter web add zod', { tool: 'pnpm', packages: ['zod'], workspace: 'web' }],
      ['pnpm -F web add -D zod', { tool: 'pnpm', packages: ['zod'], workspace: 'web' }],
      ['pnpm add --filter web zod', { tool: 'pnpm', packages: ['zod'], workspace: 'web' }],
      ['pnpm -r add typescript', { tool: 'pnpm', packages: ['typescript'] }],
      ['yarn workspace web add zod', { tool: 'yarn', packages: ['zod'], workspace: 'web' }],
      ['yarn install', { tool: 'yarn', packages: [] }],
      ['bun install hono', { tool: 'bun', packages: ['hono'] }],
      ['npm i --registry https://registry.example.com x', { tool: 'npm', packages: ['x'] }],
      ['npm add install-peers', { tool: 'npm', packages: ['install-peers'] }],
    ])('%s', (command, metadata) => {
      expect(normalize(command)).toMatchObject({ category: 'dependencies', metadata })
      expect(normalize(command).metadata).toEqual(metadata)
    })

    it('reads a workspace removal', () => {
      expect(normalize('yarn workspace web remove zod').metadata).toEqual({
        tool: 'yarn',
        packages: ['zod'],
        action: 'remove',
        workspace: 'web',
      })
    })
  })

  // WOR-127: git's own options used to turn a commit into `versioning`, losing it and its message
  describe('git global options', () => {
    it.each([
      ['git -C "/a b" commit -m "x"', 'x'],
      ['git -c user.name=x commit -m "y"', 'y'],
      ['git --work-tree=/w commit -m "z"', 'z'],
      ['git --no-pager -C ../web commit -am "both"', 'both'],
    ])('%s is a commit with its message', (command, message) => {
      expect(normalize(command)).toMatchObject({ category: 'shipping', metadata: { message } })
    })
  })

  describe('dependency remove', () => {
    it('classifies npm uninstall', () => {
      expect(category('npm uninstall lodash')).toBe('dependencies')
    })

    it('classifies npm remove', () => {
      expect(category('npm remove axios')).toBe('dependencies')
    })

    it('classifies yarn remove', () => {
      expect(category('yarn remove express')).toBe('dependencies')
    })

    it('classifies bun remove', () => {
      const result = normalize('bun remove lodash')
      expect(result.category).toBe('dependencies')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.packages).toEqual(['lodash'])
    })

    it('classifies pip uninstall', () => {
      expect(category('pip uninstall requests')).toBe('dependencies')
    })

    it('marks removals so summaries do not report them as additions', () => {
      for (const command of [
        'npm uninstall lodash',
        'yarn remove express',
        'bun remove lodash',
        'pip uninstall requests',
      ]) {
        expect(normalize(command).metadata.action).toBe('remove')
      }
      expect(normalize('npm install lodash').metadata.action).toBeUndefined()
    })
  })

  describe('test runs', () => {
    it('classifies npm test', () => {
      expect(category('npm test')).toBe('testing')
      expect(category('npm run test')).toBe('testing')
    })

    it('classifies yarn test', () => {
      const result = normalize('yarn test')
      expect(result.category).toBe('testing')
      expect(result.metadata.tool).toBe('yarn')
    })

    it('classifies pnpm test', () => {
      const result = normalize('pnpm test')
      expect(result.category).toBe('testing')
      expect(result.metadata.tool).toBe('pnpm')
    })

    it('classifies bun test', () => {
      const result = normalize('bun test')
      expect(result.category).toBe('testing')
      expect(result.metadata.tool).toBe('bun')
    })

    it('classifies jest', () => {
      expect(category('jest')).toBe('testing')
      expect(category('jest --watch')).toBe('testing')
      const result = normalize('jest')
      expect(result.metadata.tool).toBe('jest')
    })

    it('classifies vitest', () => {
      expect(category('vitest run')).toBe('testing')
    })

    it('classifies pytest', () => {
      expect(category('pytest')).toBe('testing')
      expect(category('pytest tests/')).toBe('testing')
    })

    it('classifies go test', () => {
      expect(category('go test ./...')).toBe('testing')
    })

    it('classifies cargo test', () => {
      expect(category('cargo test')).toBe('testing')
    })

    it('classifies rspec', () => {
      expect(category('rspec spec/')).toBe('testing')
    })
  })

  describe('linting', () => {
    it('classifies eslint directly', () => {
      const result = normalize('eslint src/')
      expect(result.category).toBe('linting')
      expect(result.metadata.tool).toBe('eslint')
    })

    it('classifies prettier directly', () => {
      const result = normalize('prettier --check src/')
      expect(result.category).toBe('linting')
      expect(result.metadata.tool).toBe('prettier')
    })

    it('classifies biome', () => {
      expect(category('biome check src/')).toBe('linting')
    })

    it('classifies tslint', () => {
      expect(category('tslint --project tsconfig.json')).toBe('linting')
    })

    it('classifies dprint', () => {
      expect(category('dprint fmt')).toBe('linting')
    })
  })

  describe('builds', () => {
    it('classifies npm run build', () => {
      expect(category('npm run build')).toBe('building')
    })

    it('classifies yarn build', () => {
      expect(category('yarn build')).toBe('building')
    })

    it('classifies pnpm build', () => {
      expect(category('pnpm build')).toBe('building')
    })

    it('classifies bun run build', () => {
      const result = normalize('bun run build')
      expect(result.category).toBe('building')
      expect(result.metadata.tool).toBe('bun')
    })

    it('classifies make', () => {
      expect(category('make')).toBe('building')
      expect(category('make install')).toBe('building')
    })

    it('classifies cargo build', () => {
      expect(category('cargo build --release')).toBe('building')
    })

    it('classifies go build', () => {
      expect(category('go build ./...')).toBe('building')
    })

    it('classifies docker build', () => {
      expect(category('docker build -t myapp .')).toBe('building')
    })
  })

  describe('dev servers', () => {
    it('classifies npm run dev', () => {
      const result = normalize('npm run dev')
      expect(result.category).toBe('running')
      expect(result.metadata.script).toBe('dev')
    })

    it('classifies npm run start', () => {
      expect(category('npm run start')).toBe('running')
    })

    it('classifies yarn dev', () => {
      expect(category('yarn dev')).toBe('running')
    })

    it('classifies pnpm dev', () => {
      expect(category('pnpm dev')).toBe('running')
    })

    it('classifies bun run dev', () => {
      const result = normalize('bun run dev')
      expect(result.category).toBe('running')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.script).toBe('dev')
    })

    it('classifies bun run start', () => {
      expect(category('bun run start')).toBe('running')
    })

    it('classifies Django runserver', () => {
      expect(category('python manage.py runserver')).toBe('running')
    })
  })

  describe('infrastructure', () => {
    it('classifies ssh', () => {
      const result = normalize('ssh user@production.example.com')
      expect(result.category).toBe('infrastructure')
      expect(result.metadata.tool).toBe('ssh')
    })

    it('classifies kubectl', () => {
      const result = normalize('kubectl apply -f deployment.yaml')
      expect(result.category).toBe('infrastructure')
      expect(result.metadata.subcommand).toBe('apply')
    })

    it('classifies kubectl get', () => {
      expect(category('kubectl get pods')).toBe('infrastructure')
    })

    it('classifies terraform', () => {
      const result = normalize('terraform plan')
      expect(result.category).toBe('infrastructure')
      expect(result.metadata.tool).toBe('terraform')
      expect(result.metadata.subcommand).toBe('plan')
    })

    it('classifies helm', () => {
      expect(category('helm upgrade myapp ./chart')).toBe('infrastructure')
    })

    it('classifies docker run', () => {
      expect(category('docker run -p 3000:3000 myapp')).toBe('infrastructure')
    })

    it('classifies docker compose', () => {
      expect(category('docker compose up')).toBe('infrastructure')
    })

    it('classifies aws cli', () => {
      expect(category('aws s3 ls')).toBe('infrastructure')
    })

    it('classifies gcloud', () => {
      expect(category('gcloud run deploy')).toBe('infrastructure')
    })
  })

  describe('releasing', () => {
    it('classifies npm publish', () => {
      expect(category('npm publish')).toBe('releasing')
    })

    it('classifies cargo publish', () => {
      expect(category('cargo publish')).toBe('releasing')
    })

    it('classifies docker push', () => {
      const result = normalize('docker push myorg/myimage:latest')
      expect(result.category).toBe('releasing')
      expect(result.metadata.tool).toBe('docker')
      expect(result.metadata.image).toBe('myorg/myimage:latest')
    })

    it('classifies gh release create', () => {
      const result = normalize('gh release create v1.0.0')
      expect(result.category).toBe('releasing')
      expect(result.metadata.tool).toBe('gh')
    })

    it('classifies fly deploy', () => {
      const result = normalize('fly deploy')
      expect(result.category).toBe('releasing')
      expect(result.metadata.tool).toBe('fly')
    })

    it('classifies vercel deploy', () => {
      expect(category('vercel deploy')).toBe('releasing')
    })

    it('classifies netlify deploy', () => {
      expect(category('netlify deploy')).toBe('releasing')
    })

    it('classifies railway up', () => {
      expect(category('railway up')).toBe('releasing')
    })

    it('classifies wrangler deploy', () => {
      expect(category('wrangler deploy')).toBe('releasing')
    })
  })

  describe('database', () => {
    it('classifies psql', () => {
      const result = normalize('psql -U postgres mydb')
      expect(result.category).toBe('database')
      expect(result.metadata.tool).toBe('psql')
    })

    it('classifies mysql', () => {
      expect(category('mysql -u root -p')).toBe('database')
    })

    it('classifies sqlite3', () => {
      expect(category('sqlite3 dev.db')).toBe('database')
    })

    it('classifies mongosh', () => {
      expect(category('mongosh')).toBe('database')
    })

    it('classifies redis-cli', () => {
      expect(category('redis-cli')).toBe('database')
    })

    it('classifies pgcli', () => {
      expect(category('pgcli mydb')).toBe('database')
    })

    it('classifies mycli', () => {
      expect(category('mycli -u root')).toBe('database')
    })
  })

  describe('script runs', () => {
    it('classifies bash scripts', () => {
      const result = normalize('bash deploy.sh')
      expect(result.category).toBe('running')
      expect(result.metadata.shell).toBe('bash')
    })

    it('classifies node scripts', () => {
      expect(category('node scripts/migrate.js')).toBe('running')
    })

    it('classifies python scripts', () => {
      expect(category('python3 scripts/seed.py')).toBe('running')
    })

    it('classifies generic npm run scripts', () => {
      const result = normalize('npm run lint')
      expect(result.category).toBe('running')
      expect(result.metadata.script).toBe('lint')
    })

    it('classifies npm run format', () => {
      expect(category('npm run format')).toBe('running')
    })

    it('classifies bun run lint', () => {
      const result = normalize('bun run lint')
      expect(result.category).toBe('running')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.script).toBe('lint')
    })
  })

  describe('code_search', () => {
    it('classifies grep', () => {
      const result = normalize('grep -r "something" src/')
      expect(result.category).toBe('exploring')
      expect(result.metadata.tool).toBe('grep')
    })

    it('classifies grep variants', () => {
      expect(category('egrep "pattern" file.txt')).toBe('exploring')
      expect(category('fgrep "string" file.txt')).toBe('exploring')
    })

    it('classifies rg', () => {
      const result = normalize('rg "TODO" src/')
      expect(result.category).toBe('exploring')
      expect(result.metadata.tool).toBe('rg')
    })

    it('classifies ag', () => {
      expect(category('ag "pattern"')).toBe('exploring')
    })

    it('classifies find', () => {
      const result = normalize('find . -name "*.ts"')
      expect(result.category).toBe('exploring')
      expect(result.metadata.tool).toBe('find')
    })
  })

  describe('code_read', () => {
    it('classifies cat', () => {
      const result = normalize('cat src/index.ts')
      expect(result.category).toBe('exploring')
      expect(result.metadata.tool).toBe('cat')
    })

    it('classifies head and tail', () => {
      expect(category('head -n 20 README.md')).toBe('exploring')
      expect(category('tail -f app.log')).toBe('exploring')
    })

    it('classifies less and more', () => {
      expect(category('less package.json')).toBe('exploring')
      expect(category('more README.md')).toBe('exploring')
    })

    it('classifies bat', () => {
      expect(category('bat src/index.ts')).toBe('exploring')
    })
  })

  describe('file_ops', () => {
    it('classifies cp', () => {
      const result = normalize('cp src/foo.ts src/bar.ts')
      expect(result.category).toBe('files')
      expect(result.metadata.tool).toBe('cp')
    })

    it('classifies mv', () => {
      expect(category('mv old-name.ts new-name.ts')).toBe('files')
    })

    it('classifies rm', () => {
      expect(category('rm -rf dist/')).toBe('files')
    })

    it('classifies mkdir', () => {
      expect(category('mkdir -p src/components')).toBe('files')
    })

    it('classifies touch', () => {
      expect(category('touch .env.local')).toBe('files')
    })

    it('classifies chmod', () => {
      expect(category('chmod +x scripts/deploy.sh')).toBe('files')
    })
  })

  describe('environment', () => {
    it('classifies export', () => {
      const result = normalize('export NODE_ENV=production')
      expect(result.category).toBe('files')
      expect(result.metadata.variable).toBe('NODE_ENV')
    })

    it('classifies source', () => {
      expect(category('source .env')).toBe('files')
      expect(category('source ~/.zshrc')).toBe('files')
    })
  })

  describe('npx commands', () => {
    it('classifies npx vitest as test_run', () => {
      const result = normalize('npx vitest run tests/foo.test.ts')
      expect(result.category).toBe('testing')
      expect(result.metadata.tool).toBe('vitest')
    })

    it('classifies npx jest as test_run', () => {
      expect(category('npx jest --watch')).toBe('testing')
    })

    it('classifies npx tsc as build', () => {
      expect(category('npx tsc --noEmit')).toBe('building')
    })

    it('classifies npx eslint as linting', () => {
      const result = normalize('npx eslint src tests')
      expect(result.category).toBe('linting')
      expect(result.metadata.tool).toBe('eslint')
    })

    it('classifies npx prettier as linting', () => {
      const result = normalize('npx prettier --write src')
      expect(result.category).toBe('linting')
      expect(result.metadata.tool).toBe('prettier')
    })

    it('classifies generic npx as script_run', () => {
      const result = normalize('npx husky init')
      expect(result.category).toBe('running')
      expect(result.metadata.tool).toBe('husky')
    })

    it('classifies npx create-* as script_run', () => {
      expect(category('npx create-react-app my-app')).toBe('running')
    })

    it.each([
      ['npx --no-install vitest run', 'testing', 'vitest'],
      ['npx -y vitest run', 'testing', 'vitest'],
      ['npx --yes eslint .', 'linting', 'eslint'],
      ['npx --no-install tsc --noEmit', 'building', 'tsc'],
      ['npx -y --no-install prettier --check .', 'linting', 'prettier'],
      ['cd app && npx --no-install vitest run 2>&1 | tail -5', 'testing', 'vitest'],
    ])("reads the tool after npx's own boolean flags in %s", (command, expectedCategory, expectedTool) => {
      const result = normalize(command)

      expect(result.category).toBe(expectedCategory)
      expect(result.metadata.tool).toBe(expectedTool)
    })

    it('names the tool, not the flag, for an npx tool no rule knows', () => {
      expect(normalize('npx --yes husky init').metadata.tool).toBe('husky')
    })

    it.each([
      'npx -p typescript tsc --noEmit',
      'npx --package=typescript tsc',
      'npx -c "vitest run"',
      'npx --registry https://registry.example.com vitest run',
    ])('leaves %s as it was: a flag with a value is not guessed at', (command) => {
      expect(normalize(command).category).toBe('running')
    })
  })

  describe('unknown commands', () => {
    it('returns other for unknown commands', () => {
      expect(category('mkcert localhost')).toBe('other')
      expect(category('htop')).toBe('other')
      expect(category('some-custom-tool --flag')).toBe('other')
    })

    it('returns empty metadata for other', () => {
      const result = normalize('unknowntool')
      expect(result.category).toBe('other')
      expect(result.metadata).toEqual({})
    })
  })

  describe('ai_session', () => {
    it('classifies claude as ai_session', () => {
      const result = normalize('claude')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('claude')
    })

    it('classifies claude with args as ai_session', () => {
      expect(category('claude --continue')).toBe('ai_session')
    })

    it('classifies aider as ai_session', () => {
      const result = normalize('aider')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('aider')
    })

    it('classifies aider with flags as ai_session', () => {
      expect(category('aider --model gpt-4')).toBe('ai_session')
    })

    it('classifies gemini as ai_session', () => {
      const result = normalize('gemini')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('gemini')
    })

    it('classifies gh copilot as ai_session', () => {
      const result = normalize('gh copilot suggest "write a test"')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('gh copilot')
    })

    it('classifies cody as ai_session', () => {
      const result = normalize('cody chat')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('cody')
    })

    it('classifies amazon-q chat as ai_session', () => {
      const result = normalize('q chat')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('amazon-q')
    })

    it('classifies amazon-q dev as ai_session', () => {
      const result = normalize('q dev')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('amazon-q')
    })

    it('classifies continue as ai_session', () => {
      const result = normalize('continue')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('continue')
    })

    it('classifies cursor as ai_session', () => {
      const result = normalize('cursor .')
      expect(result.category).toBe('ai_session')
      expect(result.metadata.tool).toBe('cursor')
    })

    it('does not classify bare q as ai_session', () => {
      expect(category('q something')).toBe('other')
    })
  })

  describe('git -C flag handling', () => {
    it('classifies git -C <path> commit as code_commit', () => {
      expect(category('git -C /Users/mark/sandbox/project commit -m "fix: auth"')).toBe('shipping')
    })

    it('extracts commit message from git -C commit', () => {
      const result = normalize('git -C /home/user/project commit -m "feat: add login"')
      expect(result.metadata.message).toBe('feat: add login')
    })

    it('classifies git -C push as code_push', () => {
      expect(category('git -C /home/user/project push origin main')).toBe('shipping')
    })

    it('classifies git -C pull as code_pull', () => {
      expect(category('git -C /home/user/project pull')).toBe('versioning')
    })

    it('classifies git -C status as exploring', () => {
      expect(category('git -C /home/user/project status')).toBe('exploring')
    })

    it('classifies git -C add as git_other', () => {
      expect(category('git -C /home/user/project add src/')).toBe('versioning')
    })
  })

  describe('whitespace handling', () => {
    it('handles extra leading/trailing whitespace', () => {
      expect(category('  git commit -m "fix"  ')).toBe('shipping')
    })

    it('collapses multiple spaces', () => {
      expect(category('npm  install  axios')).toBe('dependencies')
    })
  })
})
