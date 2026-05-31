import { BrowserWindow, dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { SessionExportPayload, SessionExportRecap } from '../../shared/types.js'

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

function renderRecapHtml(recap: SessionExportRecap): string {
  const sections: string[] = []
  sections.push(
    `<div class="recap-block"><div class="recap-label">TL;DR</div><div class="body">${escapeHtml(
      recap.tldr
    )}</div></div>`
  )
  if (recap.actionItems.length > 0) {
    const items = recap.actionItems
      .map((a) => {
        const owner = a.owner === 'you' ? 'You' : a.owner === 'them' ? 'Them' : '?'
        const due = a.dueHint ? ` — ${escapeHtml(a.dueHint)}` : ''
        return `<li><strong>(${owner})</strong> ${escapeHtml(a.text)}${due}</li>`
      })
      .join('')
    sections.push(
      `<div class="recap-block"><div class="recap-label">Action items</div><ul>${items}</ul></div>`
    )
  }
  if (recap.decisions.length > 0) {
    const items = recap.decisions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')
    sections.push(
      `<div class="recap-block"><div class="recap-label">Decisions</div><ul>${items}</ul></div>`
    )
  }
  if (recap.openQuestions.length > 0) {
    const items = recap.openQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')
    sections.push(
      `<div class="recap-block"><div class="recap-label">Open questions</div><ul>${items}</ul></div>`
    )
  }
  if (recap.followUp) {
    sections.push(
      `<div class="recap-block"><div class="recap-label">Follow-up</div>
        <div class="body"><strong>Subject:</strong> ${escapeHtml(recap.followUp.subject)}</div>
        <div class="body">${escapeHtml(recap.followUp.body)}</div>
      </div>`
    )
  }
  return `<section class="recap">
    <h2>Recap</h2>
    ${sections.join('\n')}
  </section>`
}

function renderHtml(payload: SessionExportPayload): string {
  const dateStr = new Date(payload.startedAt).toLocaleString()
  const recapHtml = payload.recap ? renderRecapHtml(payload.recap) : ''
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
  h2 { font-size: 14pt; margin: 0 0 8px; }
  .date { font-size: 9pt; color: #666; margin-bottom: 18px; }
  .block { margin-bottom: 10px; page-break-inside: avoid; }
  .meta { font-size: 9pt; color: #666; font-weight: 600; }
  .body { white-space: pre-wrap; word-wrap: break-word; margin-top: 2px; }
  .qa .answer { padding-left: 8px; border-left: 2px solid #ddd; }
  .recap { margin-bottom: 22px; padding-bottom: 14px; border-bottom: 1px solid #ddd; }
  .recap-block { margin-bottom: 10px; page-break-inside: avoid; }
  .recap-label { font-size: 9pt; color: #666; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .recap ul { margin: 4px 0 0; padding-left: 18px; }
  .recap li { margin-bottom: 2px; }
</style>
</head>
<body>
  <h1>${escapeHtml(payload.title || 'Untitled session')}</h1>
  <div class="date">${escapeHtml(dateStr)}</div>
  ${recapHtml}
  ${blocks}
</body>
</html>`
}
