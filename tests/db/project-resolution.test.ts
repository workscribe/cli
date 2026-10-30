import { describe, it, expect } from 'vitest'
import { resolvePairs } from '../../src/db/jobs/project-resolution'
import type { DirectoryProbe } from '../../src/capture/git'

const repo = (root: string, remoteUrl: string | null): DirectoryProbe => ({
  outcome: 'repo',
  root,
  commonDir: `${root}/.git`,
  remoteUrl,
})

describe('resolvePairs', () => {
  const probes = new Map<string, DirectoryProbe>([
    ['/code/one', repo('/code/one', 'git@github.com:alice/x.git')],
    ['/code/two', repo('/code/two', 'git@github.com:bob/x.git')],
    ['/code/plain', repo('/code/plain', null)],
  ])

  it('never guesses between two live projects stored under the same bare name', () => {
    const resolutions = resolvePairs(
      [
        { cwd: '/code/one', repoName: 'x' },
        { cwd: '/code/two', repoName: 'x' },
        { cwd: '/gone/x', repoName: 'x' },
      ],
      probes
    )

    expect(resolutions[2]).toMatchObject({ method: 'name', project: { identity: 'name:x', kind: 'name' } })
  })

  it('joins a gone owner/repo to the one live remote it names, whatever the host', () => {
    const [, resolution] = resolvePairs(
      [
        { cwd: '/code/one', repoName: 'x' },
        { cwd: '/gone/x', repoName: 'Alice/x' },
      ],
      probes
    )

    expect(resolution).toMatchObject({ method: 'qualified-name', project: { identity: 'remote:github.com/alice/x' } })
  })

  it('keys a repo with no remote by its git folder', () => {
    const [resolution] = resolvePairs([{ cwd: '/code/plain', repoName: 'plain' }], probes)

    expect(resolution).toMatchObject({ method: 'git', project: { identity: 'local:/code/plain/.git', kind: 'local' } })
  })

  it('merges a gone bare name into the one gone owner/repo with the same repo', () => {
    const resolutions = resolvePairs(
      [
        { cwd: '/gone/a', repoName: 'carol/tool' },
        { cwd: '/gone/b', repoName: 'tool' },
      ],
      probes
    )

    expect(resolutions.map((resolution) => resolution.project?.identity)).toEqual([
      'name:carol/tool',
      'name:carol/tool',
    ])
  })

  it('joins a gone folder to the live checkout above it, before trying its name', () => {
    const [, resolution] = resolvePairs(
      [
        { cwd: '/code/one', repoName: 'x' },
        { cwd: '/code/one/deleted-folder', repoName: 'renamed' },
      ],
      probes
    )

    expect(resolution).toMatchObject({ method: 'folder', project: { identity: 'remote:github.com/alice/x' } })
  })

  it('links nothing for a pair captured outside a repo, even if the folder is a repo now', () => {
    const [resolution] = resolvePairs([{ cwd: '/code/one', repoName: null }], probes)

    expect(resolution).toEqual({ cwd: '/code/one', repoName: null, method: 'none', project: null })
  })

  it("takes the repo a stored name names over the folder's own, when the name fits one other live project", () => {
    const resolutions = resolvePairs(
      [
        { cwd: '/code/one', repoName: 'x' },
        { cwd: '/code/two', repoName: 'bob/x' },
        // `git -C ../one push`, typed in two: two's folder, one's name
        { cwd: '/code/two', repoName: 'alice/x' },
      ],
      probes
    )

    expect(resolutions[2]).toMatchObject({
      method: 'qualified-name',
      project: { identity: 'remote:github.com/alice/x' },
    })
  })
})
