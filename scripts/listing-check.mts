/**
 * The store listing, against the stores' limits.
 *
 * `docs/store/listing.md` is the copy that gets pasted into App Store Connect
 * and Google Play. Each field is written as a `### Heading [limit]` followed by
 * a blockquote, or as a `| Field [limit] | value |` table row. This reads both
 * shapes, counts characters the way Apple does (code points, not bytes), and
 * fails on anything over — so an edit that pushes the subtitle to 31 fails
 * here rather than in the console.
 *
 *   npm run check:listing
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../docs/store/listing.md', import.meta.url)), 'utf8')
const lines = source.split('\n')

type Field = { name: string; limit: number; value: string }
const fields: Field[] = []

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]

  // `### Promotional text [170]` — the value is the next blockquote, joined
  // the way the console joins it: `> ` stripped, blank quote lines as
  // paragraph breaks.
  const heading = /^### (.+?) \[(\d+)\]/.exec(line)
  if (heading) {
    const quote: string[] = []
    let j = i + 1
    while (j < lines.length && !lines[j].startsWith('>')) j++
    while (j < lines.length && lines[j].startsWith('>')) quote.push(lines[j].replace(/^> ?/, '')), j++
    fields.push({ name: heading[1], limit: Number(heading[2]), value: quote.join('\n').trim() })
    continue
  }

  // `| Subtitle [30] | Your Hermes agent, remote |`
  const row = /^\| (.+?) \[(\d+)\]\s*\| (.+?)\s*\|/.exec(line)
  if (row) fields.push({ name: row[1], limit: Number(row[2]), value: row[3].trim() })
}

let failed = false
for (const { name, limit, value } of fields) {
  const length = [...value].length
  const over = length > limit
  // A prose pointer ("The description above, unchanged") is not the value.
  const skipped = /^the .* above/i.test(value)
  if (over) failed = true
  console.log(`${over ? 'FAIL' : skipped ? 'skip' : ' ok '}  ${String(length).padStart(4)}/${limit}  ${name}`)
}

const keywords = fields.find((f) => f.name === 'Keywords')
if (keywords && /,\s/.test(keywords.value)) {
  failed = true
  console.log('FAIL  keywords: space after a comma counts against the 100')
}

if (fields.length === 0) {
  failed = true
  console.log('FAIL  no fields found — the headings or table rows changed shape')
}

process.exit(failed ? 1 : 0)
