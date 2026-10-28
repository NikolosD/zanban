import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ReferenceDocKind } from '../../shared/types.js'

export interface ExtractResult {
  kind: ReferenceDocKind
  text: string
  bytes: number
}

const MAX_DOC_BYTES = 50 * 1024 * 1024
const ALLOWED_EXTS = new Set(['.pdf', '.docx', '.md', '.txt'])

export async function extractFromPath(filePath: string): Promise<ExtractResult> {
  const ext = extname(filePath).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext || '(no extension)'}`)
  }
  const info = await stat(filePath)
  if (!info.isFile()) {
    throw new Error('Path is not a regular file')
  }
  if (info.size > MAX_DOC_BYTES) {
    throw new Error(`File too large: ${(info.size / 1024 / 1024).toFixed(1)}MB (max 50MB)`)
  }
  const buf = await readFile(filePath)
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
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buf })
  try {
    // An empty joiner drops the default "-- N of M --" page markers, which would
    // otherwise end up inside the indexed RAG chunks.
    const out = await parser.getText({ pageJoiner: '' })
    return out.text.trim()
  } finally {
    await parser.destroy()
  }
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const out = await mammoth.extractRawText({ buffer: buf })
  return out.value.trim()
}
