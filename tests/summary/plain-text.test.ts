import { describe, it, expect } from 'vitest'
import { toPlainText } from '../../src/summary/plain-text'

describe('toPlainText', () => {
  it('turns headings at every level the summaries use into plain lines', () => {
    expect(toPlainText('# Week\n## api (main) — 2h\n### main — Mon 2 Nov')).toBe(
      'Week\napi (main) — 2h\nmain — Mon 2 Nov'
    )
  })

  it('makes every bullet a "- " line, keeping indentation', () => {
    expect(toPlainText('- one\n* two\n• three\n  * nested')).toBe('- one\n- two\n- three\n  - nested')
  })

  it('reduces bold and code to their text, in saved and template lines alike', () => {
    expect(toPlainText('- **Shipped** the fix')).toBe('- Shipped the fix')
    expect(toPlainText('- Committed: fix `foo` in `bar`')).toBe('- Committed: fix foo in bar')
  })

  it('keeps the address of a link', () => {
    expect(toPlainText('- Committed: fix [docs](https://example.com/a)')).toBe(
      '- Committed: fix docs (https://example.com/a)'
    )
  })

  it('handles a bullet that starts with bold', () => {
    expect(toPlainText('* **Fixed** it')).toBe('- Fixed it')
  })

  it('leaves real text that only looks like markdown', () => {
    const text = '- Committed: match *.ts in snake_case_name, closes #123\n#123 was the cause\n2 * 3 = 6'
    expect(toPlainText(text)).toBe(text)
  })

  it('keeps plain lines and the blank lines between sections', () => {
    const text = 'On main:\n- Tests passing\nAlongside: web\n\nTime worked: 2h'
    expect(toPlainText(text)).toBe(text)
  })

  it('removes blank lines around the summary', () => {
    expect(toPlainText('\n## api\n- Done\n\n')).toBe('api\n- Done')
  })
})
