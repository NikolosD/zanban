import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ReferenceDocKind } from '../../shared/types.js'

export interface ExtractResult {
  kind: ReferenceDocKind
  text: string
  bytes: number
}

export async function extractFromPath(filePath: string): Promise<ExtractResult> {
  const buf = await readFile(filePath)
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.pdf':
      return { kind: 'pdf', text: await extractPdf(buf), bytes: buf.byteLength }
    case '.docx':
      return { kind: 'docx', text: await extractDocx(buf), bytes: buf.byteLength }
    case '.md':
      return { kind: 'md', text: buf.toString('utf-8'), bytes: buf.byteLength }
    case '.txt':
      return { kind: 'txt', text: buf.toString('utf-8'), bytes: buf.byteLength }
    default:
      throw new Error(`Unsupported file type: ${ext || '(no extension)'}`)
  }
}

async function extractPdf(buf: Buffer): Promise<string> {
  const mod = await import('pdf-parse')
  const pdfParse = (mod as { default?: (b: Buffer) => Promise<{ text: string }> }).default ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>)
  const out = await pdfParse(buf)
  return out.text.trim()
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const out = await mammoth.extractRawText({ buffer: buf })
  return out.value.trim()
}
