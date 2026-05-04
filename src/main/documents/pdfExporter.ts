import { BrowserWindow, dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { SessionExportPayload } from '../../shared/types.js'

/**
 * Export a session as PDF.
 *
 * The previous implementation used jsPDF with the built-in Helvetica font,
 * which has no Unicode coverage — Cyrillic text rendered as blanks and the
 * exported file looked broken to the user. Switching to Chromium's native
 * `webContents.printToPDF` lets us use any system font, full Unicode, plus
 * proper line wrapping. The trade-off is spinning up an offscreen window for
 * each export, but exports are rare and a hidden window is cheap.
 */
export async function exportSessionPdf(payload: SessionExportPayload): Promise<string | null> {
  const safeTitle = payload.title.replace(/[^a-z0-9_\-Ѐ-ӿ\s]/gi, '').trim() || 'session'
  const result = await dialog.showSaveDialog({
    title: 'Export session as PDF',
    defaultPath: `${safeTitle}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return null

  const html = renderHtml(payload)
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const buffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    })
    await writeFile(result.filePath, buffer)
    shell.showItemInFolder(result.filePath)
    return result.filePath
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderHtml(payload: SessionExportPayload): string {
  const dateStr = new Date(payload.startedAt).toLocaleString()
  const blocks = payload.blocks
    .map((b) => {
      const ts = new Date(b.ts).toLocaleTimeString()
      if (b.kind === 'transcript') {
        return `<div class="block transcript">
          <div class="meta">[${escapeHtml(ts)}] ${escapeHtml(b.speaker)}</div>
          <div class="body">${escapeHtml(b.text)}</div>
        </div>`
      }
      if (b.kind === 'qa') {
        return `<div class="block qa">
          <div class="meta">[${escapeHtml(ts)}] Q</div>
          <div class="body">${escapeHtml(b.question)}</div>
          <div class="meta">[${escapeHtml(ts)}] A</div>
          <div class="body answer">${escapeHtml(b.answer)}</div>
        </div>`
      }
      return `<div class="block note">
        <div class="meta">[${escapeHtml(ts)}] Note</div>
        <div class="body">${escapeHtml(b.text)}</div>
      </div>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(payload.title || 'Untitled session')}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: #111;
    font-size: 11pt;
    line-height: 1.45;
    padding: 24px 28px;
  }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  .date { font-size: 9pt; color: #666; margin-bottom: 18px; }
  .block { margin-bottom: 10px; page-break-inside: avoid; }
  .meta { font-size: 9pt; color: #666; font-weight: 600; }
  .body { white-space: pre-wrap; word-wrap: break-word; margin-top: 2px; }
  .qa .answer { padding-left: 8px; border-left: 2px solid #ddd; }
</style>
</head>
<body>
  <h1>${escapeHtml(payload.title || 'Untitled session')}</h1>
  <div class="date">${escapeHtml(dateStr)}</div>
  ${blocks}
</body>
</html>`
}
