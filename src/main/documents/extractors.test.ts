import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractFromPath } from './extractors.js'

function minimalPdf(pages: string[]): Buffer {
  const fontId = 3 + pages.length * 2
  const pageIds = pages.map((_, i) => 3 + i * 2)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  ]
  pages.forEach((text, i) => {
    const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageIds[i]! + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    )
  })
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefAt = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

describe('extractFromPath', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zanban-extract-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('extracts text from a PDF', async () => {
    const file = join(dir, 'doc.pdf')
    const pdf = minimalPdf(['Hello Zanban'])
    await writeFile(file, pdf)
    const out = await extractFromPath(file)
    expect(out.kind).toBe('pdf')
    expect(out.text).toBe('Hello Zanban')
    expect(out.bytes).toBe(pdf.byteLength)
  })

  it('extracts every page of a multi-page PDF in order', async () => {
    const file = join(dir, 'pages.pdf')
    await writeFile(file, minimalPdf(['First page', 'Second page', 'Third page']))
    const out = await extractFromPath(file)
    expect(out.text.split('\n')).toEqual(['First page', 'Second page', 'Third page'])
  })
})
