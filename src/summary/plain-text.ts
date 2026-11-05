/**
 * A finished summary as plain text, to paste into a form or report. Every line goes through it: saved summaries are
 * free text, and commit subjects and notes reach the template verbatim.
 *
 * Only line-start markers and paired forms change. A lone `*` or `_` stays, since `*.ts` and `snake_case` are real text.
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6} +/gm, '')
    .replace(/^([ \t]*)[*•] +/gm, '$1- ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .trim()
}
