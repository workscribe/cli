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
      expect(category('git commit -m "fix: auth bug"')).toBe('code_commit')
    })

    it('extracts commit message', () => {
      const result = normalize('git commit -m "fix: auth bug"')
      expect(result.metadata.message).toBe('fix: auth bug')
    })

    it('classifies git commit with no message flag', () => {
      expect(category('git commit --amend')).toBe('code_commit')
    })

    it('classifies git push', () => {
      expect(category('git push')).toBe('code_push')
      expect(category('git push origin main')).toBe('code_push')
    })

    it('extracts remote and branch from git push', () => {
      const result = normalize('git push origin feature/auth')
      expect(result.metadata.remote).toBe('origin')
      expect(result.metadata.branch).toBe('feature/auth')
    })

    it('classifies git pull', () => {
      expect(category('git pull')).toBe('code_pull')
      expect(category('git pull origin main')).toBe('code_pull')
    })

    it('classifies git fetch', () => {
      expect(category('git fetch')).toBe('code_pull')
    })

    it('classifies git checkout as branch_switch', () => {
      expect(category('git checkout feature/auth')).toBe('branch_switch')
    })

    it('classifies git switch as branch_switch', () => {
      expect(category('git switch main')).toBe('branch_switch')
    })

    it('classifies git merge', () => {
      expect(category('git merge feature/auth')).toBe('code_merge')
    })

    it('classifies git rebase', () => {
      expect(category('git rebase main')).toBe('code_merge')
    })

    it('classifies git stash', () => {
      expect(category('git stash')).toBe('code_stash')
      expect(category('git stash pop')).toBe('code_stash')
    })

    it('classifies other git commands as git_other', () => {
      expect(category('git log --oneline')).toBe('git_other')
      expect(category('git diff HEAD')).toBe('git_other')
      expect(category('git status')).toBe('git_other')
    })
  })

  describe('dependency install', () => {
    it('classifies npm install', () => {
      expect(category('npm install')).toBe('dependency_install')
      expect(category('npm install axios')).toBe('dependency_install')
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

    it('classifies npm i shorthand', () => {
      expect(category('npm i axios')).toBe('dependency_install')
    })

    it('classifies yarn add', () => {
      expect(category('yarn add react')).toBe('dependency_install')
      const result = normalize('yarn add react react-dom')
      expect(result.metadata.tool).toBe('yarn')
    })

    it('classifies pnpm add', () => {
      expect(category('pnpm add typescript')).toBe('dependency_install')
    })

    it('classifies bun add', () => {
      const result = normalize('bun add react react-dom')
      expect(result.category).toBe('dependency_install')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.packages).toEqual(['react', 'react-dom'])
    })

    it('classifies bun install', () => {
      expect(category('bun install')).toBe('dependency_install')
    })

    it('classifies pip install', () => {
      const result = normalize('pip install requests flask')
      expect(result.category).toBe('dependency_install')
      expect(result.metadata.tool).toBe('pip')
      expect(result.metadata.packages).toEqual(['requests', 'flask'])
    })

    it('classifies cargo add', () => {
      const result = normalize('cargo add serde')
      expect(result.category).toBe('dependency_install')
      expect(result.metadata.tool).toBe('cargo')
    })

    it('classifies brew install', () => {
      expect(category('brew install jq')).toBe('dependency_install')
    })

    it('classifies go get', () => {
      expect(category('go get github.com/pkg/errors')).toBe('dependency_install')
    })
  })

  describe('dependency remove', () => {
    it('classifies npm uninstall', () => {
      expect(category('npm uninstall lodash')).toBe('dependency_remove')
    })

    it('classifies npm remove', () => {
      expect(category('npm remove axios')).toBe('dependency_remove')
    })

    it('classifies yarn remove', () => {
      expect(category('yarn remove express')).toBe('dependency_remove')
    })

    it('classifies bun remove', () => {
      const result = normalize('bun remove lodash')
      expect(result.category).toBe('dependency_remove')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.packages).toEqual(['lodash'])
    })

    it('classifies pip uninstall', () => {
      expect(category('pip uninstall requests')).toBe('dependency_remove')
    })
  })

  describe('test runs', () => {
    it('classifies npm test', () => {
      expect(category('npm test')).toBe('test_run')
      expect(category('npm run test')).toBe('test_run')
    })

    it('classifies yarn test', () => {
      const result = normalize('yarn test')
      expect(result.category).toBe('test_run')
      expect(result.metadata.tool).toBe('yarn')
    })

    it('classifies pnpm test', () => {
      const result = normalize('pnpm test')
      expect(result.category).toBe('test_run')
      expect(result.metadata.tool).toBe('pnpm')
    })

    it('classifies bun test', () => {
      const result = normalize('bun test')
      expect(result.category).toBe('test_run')
      expect(result.metadata.tool).toBe('bun')
    })

    it('classifies jest', () => {
      expect(category('jest')).toBe('test_run')
      expect(category('jest --watch')).toBe('test_run')
      const result = normalize('jest')
      expect(result.metadata.tool).toBe('jest')
    })

    it('classifies vitest', () => {
      expect(category('vitest run')).toBe('test_run')
    })

    it('classifies pytest', () => {
      expect(category('pytest')).toBe('test_run')
      expect(category('pytest tests/')).toBe('test_run')
    })

    it('classifies go test', () => {
      expect(category('go test ./...')).toBe('test_run')
    })

    it('classifies cargo test', () => {
      expect(category('cargo test')).toBe('test_run')
    })

    it('classifies rspec', () => {
      expect(category('rspec spec/')).toBe('test_run')
    })
  })

  describe('builds', () => {
    it('classifies npm run build', () => {
      expect(category('npm run build')).toBe('build')
    })

    it('classifies yarn build', () => {
      expect(category('yarn build')).toBe('build')
    })

    it('classifies pnpm build', () => {
      expect(category('pnpm build')).toBe('build')
    })

    it('classifies bun run build', () => {
      const result = normalize('bun run build')
      expect(result.category).toBe('build')
      expect(result.metadata.tool).toBe('bun')
    })

    it('classifies make', () => {
      expect(category('make')).toBe('build')
      expect(category('make install')).toBe('build')
    })

    it('classifies cargo build', () => {
      expect(category('cargo build --release')).toBe('build')
    })

    it('classifies go build', () => {
      expect(category('go build ./...')).toBe('build')
    })

    it('classifies docker build', () => {
      expect(category('docker build -t myapp .')).toBe('build')
    })
  })

  describe('dev servers', () => {
    it('classifies npm run dev', () => {
      const result = normalize('npm run dev')
      expect(result.category).toBe('server_run')
      expect(result.metadata.script).toBe('dev')
    })

    it('classifies npm run start', () => {
      expect(category('npm run start')).toBe('server_run')
    })

    it('classifies yarn dev', () => {
      expect(category('yarn dev')).toBe('server_run')
    })

    it('classifies pnpm dev', () => {
      expect(category('pnpm dev')).toBe('server_run')
    })

    it('classifies bun run dev', () => {
      const result = normalize('bun run dev')
      expect(result.category).toBe('server_run')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.script).toBe('dev')
    })

    it('classifies bun run start', () => {
      expect(category('bun run start')).toBe('server_run')
    })

    it('classifies Django runserver', () => {
      expect(category('python manage.py runserver')).toBe('server_run')
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

  describe('script runs', () => {
    it('classifies bash scripts', () => {
      const result = normalize('bash deploy.sh')
      expect(result.category).toBe('script_run')
      expect(result.metadata.shell).toBe('bash')
    })

    it('classifies node scripts', () => {
      expect(category('node scripts/migrate.js')).toBe('script_run')
    })

    it('classifies python scripts', () => {
      expect(category('python3 scripts/seed.py')).toBe('script_run')
    })

    it('classifies generic npm run scripts', () => {
      const result = normalize('npm run lint')
      expect(result.category).toBe('script_run')
      expect(result.metadata.script).toBe('lint')
    })

    it('classifies npm run format', () => {
      expect(category('npm run format')).toBe('script_run')
    })

    it('classifies bun run lint', () => {
      const result = normalize('bun run lint')
      expect(result.category).toBe('script_run')
      expect(result.metadata.tool).toBe('bun')
      expect(result.metadata.script).toBe('lint')
    })
  })

  describe('code_search', () => {
    it('classifies grep', () => {
      const result = normalize('grep -r "something" src/')
      expect(result.category).toBe('code_search')
      expect(result.metadata.tool).toBe('grep')
    })

    it('classifies grep variants', () => {
      expect(category('egrep "pattern" file.txt')).toBe('code_search')
      expect(category('fgrep "string" file.txt')).toBe('code_search')
    })

    it('classifies rg', () => {
      const result = normalize('rg "TODO" src/')
      expect(result.category).toBe('code_search')
      expect(result.metadata.tool).toBe('rg')
    })

    it('classifies ag', () => {
      expect(category('ag "pattern"')).toBe('code_search')
    })

    it('classifies find', () => {
      const result = normalize('find . -name "*.ts"')
      expect(result.category).toBe('code_search')
      expect(result.metadata.tool).toBe('find')
    })
  })

  describe('code_read', () => {
    it('classifies cat', () => {
      const result = normalize('cat src/index.ts')
      expect(result.category).toBe('code_read')
      expect(result.metadata.tool).toBe('cat')
    })

    it('classifies head and tail', () => {
      expect(category('head -n 20 README.md')).toBe('code_read')
      expect(category('tail -f app.log')).toBe('code_read')
    })

    it('classifies less and more', () => {
      expect(category('less package.json')).toBe('code_read')
      expect(category('more README.md')).toBe('code_read')
    })

    it('classifies bat', () => {
      expect(category('bat src/index.ts')).toBe('code_read')
    })
  })

  describe('file_ops', () => {
    it('classifies cp', () => {
      const result = normalize('cp src/foo.ts src/bar.ts')
      expect(result.category).toBe('file_ops')
      expect(result.metadata.tool).toBe('cp')
    })

    it('classifies mv', () => {
      expect(category('mv old-name.ts new-name.ts')).toBe('file_ops')
    })

    it('classifies rm', () => {
      expect(category('rm -rf dist/')).toBe('file_ops')
    })

    it('classifies mkdir', () => {
      expect(category('mkdir -p src/components')).toBe('file_ops')
    })

    it('classifies touch', () => {
      expect(category('touch .env.local')).toBe('file_ops')
    })

    it('classifies chmod', () => {
      expect(category('chmod +x scripts/deploy.sh')).toBe('file_ops')
    })
  })

  describe('environment', () => {
    it('classifies export', () => {
      const result = normalize('export NODE_ENV=production')
      expect(result.category).toBe('environment')
      expect(result.metadata.variable).toBe('NODE_ENV')
    })

    it('classifies source', () => {
      expect(category('source .env')).toBe('environment')
      expect(category('source ~/.zshrc')).toBe('environment')
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
      expect(category('git -C /Users/mark/sandbox/project commit -m "fix: auth"')).toBe('code_commit')
    })

    it('extracts commit message from git -C commit', () => {
      const result = normalize('git -C /home/user/project commit -m "feat: add login"')
      expect(result.metadata.message).toBe('feat: add login')
    })

    it('classifies git -C push as code_push', () => {
      expect(category('git -C /home/user/project push origin main')).toBe('code_push')
    })

    it('classifies git -C pull as code_pull', () => {
      expect(category('git -C /home/user/project pull')).toBe('code_pull')
    })

    it('classifies git -C status as git_other', () => {
      expect(category('git -C /home/user/project status')).toBe('git_other')
    })

    it('classifies git -C add as git_other', () => {
      expect(category('git -C /home/user/project add src/')).toBe('git_other')
    })
  })

  describe('whitespace handling', () => {
    it('handles extra leading/trailing whitespace', () => {
      expect(category('  git commit -m "fix"  ')).toBe('code_commit')
    })

    it('collapses multiple spaces', () => {
      expect(category('npm  install  axios')).toBe('dependency_install')
    })
  })
})
