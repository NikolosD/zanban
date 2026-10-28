import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ReferenceDocKind } from '../../shared/types.js'
import { mlWorker } from '../ml/index.js'

export interface ExtractResult {
  kind: ReferenceDocKind
  text: string
  bytes: number
}

const MAX_DOC_BYTES = 50 * 1024 * 1024
const ALLOWED_EXTS = new Set(['.pdf', '.docx', '.md', '.txt'])
// A large PDF parses slowly, and may queue behind a model load in the worker.
const EXTRACT_TIMEOUT_MS = 5 * 60_000

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
      return { kind: 'pdf', text: await extractInWorker('pdf', buf), bytes: buf.byteLength }
    case '.docx':
      return { kind: 'docx', text: await extractInWorker('docx', buf), bytes: buf.byteLength }
    case '.md':
      return { kind: 'md', text: buf.toString('utf-8'), bytes: buf.byteLength }
    case '.txt':
      return { kind: 'txt', text: buf.toString('utf-8'), bytes: buf.byteLength }
    default:
      throw new Error(`Unsupported file type: ${ext || '(no extension)'}`)
  }
}

function extractInWorker(format: 'pdf' | 'docx', data: Buffer): Promise<string> {
  return mlWorker.request({ kind: 'extract', format, data }, EXTRACT_TIMEOUT_MS)
}
