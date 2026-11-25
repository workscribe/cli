import { describe, it, expect } from 'vitest'
import { describeReads } from '../../../../src/ai/engines/template/reads'
import { event } from './fixtures'

const reading = (...reads: string[]) => ({ ...event('exploring'), reads })

describe('describeReads', () => {
  it('says nothing when no event read anything', () => {
    expect(describeReads([])).toBeNull()
    expect(describeReads([event('exploring'), reading()])).toBeNull()
  })

  it('names a plan by its ticket', () => {
    expect(describeReads([reading('docs/plan/WOR-179-remove-old-data-after-100-days.md')])).toBe(
      'Read the WOR-179 plan'
    )
  })

  it('names several plans together', () => {
    const plans = ['docs/plan/WOR-179-a.md', 'docs/plan/WOR-180-b.md']
    expect(describeReads([reading(...plans)])).toBe('Read the WOR-179 and WOR-180 plans')
    expect(describeReads([reading(...plans, 'docs/plan/WOR-181-c.md')])).toBe(
      'Read the WOR-179, WOR-180 and WOR-181 plans'
    )
  })

  it('treats a plan with no ticket as a doc', () => {
    expect(describeReads([reading('docs/plan/notes.md')])).toBe('Read docs/plan/notes.md')
  })

  it('names the files of a folder that share a word, and says what else was read there', () => {
    const files = [
      'src/db/retention-run.ts',
      'src/db/retention-status.ts',
      'src/db/retention-cleanup.ts',
      'src/db/event-delete.ts',
    ]
    expect(describeReads([reading(...files)])).toBe('Read the retention modules and src/db/event-delete.ts')
  })

  it('names a word when at least three files share it, however many other files the folder holds', () => {
    const twoShare = ['src/db/a-run.ts', 'src/db/a-status.ts', 'src/db/b.ts', 'src/db/c.ts']
    expect(describeReads([reading(...twoShare)])).toBe('Read 4 files in src/db')

    const threeShare = ['src/db/a-run.ts', 'src/db/a-status.ts', 'src/db/a-cleanup.ts', 'src/db/b.ts', 'src/db/c.ts']
    expect(describeReads([reading(...threeShare)])).toBe('Read the a modules and 2 other files in src/db')

    const threeOfTwenty = [...threeShare, ...Array.from({ length: 15 }, (_, index) => `src/db/other${index}.ts`)]
    expect(describeReads([reading(...threeOfTwenty)])).toBe('Read the a modules and 17 other files in src/db')
  })

  it('names all of a folder by the word when every file shares it', () => {
    const files = ['src/db/a-run.ts', 'src/db/a-status.ts', 'src/db/a-cleanup.ts']
    expect(describeReads([reading(...files)])).toBe('Read the a modules')
  })

  it('ignores filler words when looking for a shared word', () => {
    const files = ['src/db/index.ts', 'src/db/types.ts', 'src/db/utils.ts']
    expect(describeReads([reading(...files)])).toBe('Read 3 files in src/db')
  })

  it('names one file by its path and a small group by its folder', () => {
    expect(describeReads([reading('src/db/x.ts')])).toBe('Read src/db/x.ts')
    expect(describeReads([reading('src/db/x.ts', 'src/db/y.ts')])).toBe('Read 2 files in src/db')
  })

  it('groups source by its first two folders', () => {
    expect(describeReads([reading('src/db/x.ts', 'src/db/deep/y.ts', 'src/cli/z.ts')])).toBe(
      'Read 2 files in src/db and src/cli/z.ts'
    )
  })

  it('names tests by folder and docs by count', () => {
    expect(describeReads([reading('tests/db/a.test.ts', 'tests/db/b.test.ts', 'tests/cli/c.test.ts')])).toBe(
      'Read tests in tests/db and tests/cli'
    )
    expect(describeReads([reading('docs/site/a.md', 'docs/site/b.md')])).toBe('Read 2 docs')
    expect(describeReads([reading('docs/site/a.md')])).toBe('Read docs/site/a.md')
  })

  it('counts tests by file when there are many folders', () => {
    const tests = ['tests/a/x.test.ts', 'tests/b/x.test.ts', 'tests/c/x.test.ts']
    expect(describeReads([reading(...tests)])).toBe('Read 3 test files')
  })

  it('tells plans first, then source, tests and docs', () => {
    const files = ['docs/site/privacy.md', 'tests/db/a.test.ts', 'src/db/x.ts', 'docs/plan/WOR-179-a.md']
    expect(describeReads([reading(...files)])).toBe(
      'Read the WOR-179 plan, src/db/x.ts, tests in tests/db and docs/site/privacy.md'
    )
  })

  it('joins the reads of every event, naming each path once', () => {
    const events = [reading('src/db/x.ts'), reading('src/db/x.ts', 'src/db/y.ts')]
    expect(describeReads(events)).toBe('Read 2 files in src/db')
  })

  it('folds what is past four phrases into a count of other files', () => {
    const files = [
      'docs/plan/WOR-1-a.md',
      'src/a/x.ts',
      'src/b/x.ts',
      'src/c/x.ts',
      'tests/t/x.test.ts',
      'docs/site/d.md',
    ]
    expect(describeReads([reading(...files)])).toBe('Read the WOR-1 plan, src/a/x.ts, src/b/x.ts and 3 other files')
  })

  it('puts a file at the repository root under its own name', () => {
    expect(describeReads([reading('package.json', 'tsconfig.json')])).toBe('Read 2 files in the repository root')
  })
})
