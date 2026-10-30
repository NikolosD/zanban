// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from '@shared/locales/ru.json'
import type { ReferenceDoc } from '@shared/types'
import { ReferenceDocsTab } from './ReferenceDocsTab'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

void i18n.use(initReactI18next).init({
  lng: 'ru',
  resources: { ru: { translation: ru } },
  interpolation: { escapeValue: false }
})

const doc = (path: string): ReferenceDoc => ({
  id: path,
  name: path,
  kind: 'pdf',
  bytes: 1,
  text: 'x',
  active: true,
  addedAt: 0
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReferenceDocsTab', () => {
  it('counts uploaded documents with the Russian plural form', async () => {
    vi.stubGlobal('zanban', {
      documents: {
        list: async () => [],
        upload: async (paths: string[]) => paths.map(doc),
        getPathForFile: (file: File) => file.name
      }
    })
    const { container } = render(<ReferenceDocsTab />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const files = ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => new File(['x'], name))
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(input.disabled).toBe(false))
    expect(toast.success).toHaveBeenCalledWith('Добавлено 3 документа')
  })
})
