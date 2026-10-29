// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Toaster } from 'sonner'
import en from '@shared/locales/en.json'
import ru from '@shared/locales/ru.json'
import type { HotkeyConflict, HotkeyPickResult } from '@shared/api'
import { HotkeyConflictNotice, showHotkeyConflicts } from './HotkeyConflictNotice'

const screenshot: HotkeyConflict = { action: 'screenshot', accelerator: 'Control+Shift+1' }
const chat: HotkeyConflict = { action: 'chat', accelerator: 'Control+Alt+J' }
const hideShow: HotkeyConflict = { action: 'hideShow', accelerator: 'Control+Alt+H' }

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en }, ru: { translation: ru } },
    interpolation: { escapeValue: false }
  })
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await act(() => i18n.changeLanguage('en'))
})

function renderNotice(
  conflicts: HotkeyConflict[],
  overrides: Partial<{ onPickFree(): Promise<void> }> = {}
) {
  const onPickFree = overrides.onPickFree ?? vi.fn(async () => {})
  const onChange = vi.fn()
  render(<HotkeyConflictNotice conflicts={conflicts} onPickFree={onPickFree} onChange={onChange} />)
  return { onPickFree, onChange }
}

describe('HotkeyConflictNotice', () => {
  it('lists every busy hotkey in one notice with its action and accelerator', () => {
    renderNotice([screenshot, chat])
    const group = screen.getByRole('group', { name: '2 hotkeys are taken by other apps' })
    const rows = within(group).getAllByRole('listitem') as [HTMLElement, HTMLElement]
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Snap screen → question')).toBeTruthy()
    expect(rows[0].querySelectorAll('kbd')).toHaveLength(3)
    expect(rows[0].textContent).toContain('Ctrl')
    expect(rows[0].textContent).toContain('1')
    expect(within(rows[1]).getByText('Open chat window')).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('words the title for a single hotkey', () => {
    renderNotice([hideShow])
    expect(screen.getByRole('group', { name: '1 hotkey is taken by another app' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('opens the hotkey settings from Change…', () => {
    const { onChange, onPickFree } = renderNotice([screenshot])
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onPickFree).not.toHaveBeenCalled()
  })

  it('asks for free ones once and stays disabled until that settles', async () => {
    let settle: () => void = () => {}
    const onPickFree = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)))
    renderNotice([screenshot], { onPickFree })
    const button = screen.getByRole('button', { name: 'Pick free ones' }) as HTMLButtonElement

    fireEvent.click(button)
    fireEvent.click(button)
    expect(onPickFree).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)

    await act(async () => settle())
    expect(button.disabled).toBe(false)
  })

  it('translates itself when the UI language changes', async () => {
    renderNotice([screenshot, chat])
    await act(() => i18n.changeLanguage('ru'))
    const group = screen.getByRole('group', {
      name: '2 горячие клавиши заняты другими приложениями'
    })
    expect(within(group).getByText('Снимок экрана → вопрос')).toBeTruthy()
    expect(within(group).getByText('Открыть чат')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Подобрать свободные' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Изменить…' })).toBeTruthy()
  })

  it('uses the right Russian plural for one and five hotkeys', async () => {
    await act(() => i18n.changeLanguage('ru'))
    const { unmount } = render(
      <HotkeyConflictNotice
        conflicts={[hideShow]}
        onPickFree={async () => {}}
        onChange={() => {}}
      />
    )
    expect(
      screen.getByRole('group', { name: '1 горячая клавиша занята другим приложением' })
    ).toBeTruthy()
    unmount()

    const five: HotkeyConflict[] = [
      'toggleSession',
      'toggleOverlay',
      'askAi',
      'answerLast',
      'cropper'
    ].map((action) => ({
      action: action as HotkeyConflict['action'],
      accelerator: 'Control+Shift+9'
    }))
    renderNotice(five)
    expect(
      screen.getByRole('group', { name: '5 горячих клавиш заняты другими приложениями' })
    ).toBeTruthy()
  })
})

describe('showHotkeyConflicts', () => {
  function stubPick(result: HotkeyPickResult | Error) {
    const pickFreeHotkeys = vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    })
    vi.stubGlobal('zanban', { settings: { pickFreeHotkeys } })
    return pickFreeHotkeys
  }

  function show(failed: HotkeyConflict[], onChange = vi.fn()) {
    act(() => showHotkeyConflicts(failed, onChange))
    return onChange
  }

  it('shows one notice and updates it in place as the conflicts change', async () => {
    render(<Toaster />)
    show([screenshot, chat])
    await screen.findByRole('group', { name: '2 hotkeys are taken by other apps' })

    show([chat])
    await screen.findByRole('group', { name: '1 hotkey is taken by another app' })
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.queryByText('Snap screen → question')).toBeNull()
  })

  it('closes the notice once no conflicts are left', async () => {
    render(<Toaster />)
    show([screenshot])
    await screen.findByRole('group', { name: '1 hotkey is taken by another app' })

    show([])
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull())
  })

  it('does nothing visible when there is nothing to report', () => {
    render(<Toaster />)
    show([])
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('re-renders the open notice in the new language', async () => {
    render(<Toaster />)
    show([screenshot])
    await screen.findByRole('group', { name: '1 hotkey is taken by another app' })

    await act(() => i18n.changeLanguage('ru'))
    expect(
      screen.getByRole('group', { name: '1 горячая клавиша занята другим приложением' })
    ).toBeTruthy()
    expect(screen.getByText('Снимок экрана → вопрос')).toBeTruthy()
  })

  it('opens the hotkey settings from the toast', async () => {
    render(<Toaster />)
    const onChange = show([screenshot])
    fireEvent.click(await screen.findByRole('button', { name: 'Change…' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports what moved, with the new accelerators', async () => {
    const pick = stubPick({
      assigned: [
        { action: 'screenshot', accelerator: 'Control+Shift+4' },
        { action: 'chat', accelerator: 'Control+Alt+Shift+R' }
      ],
      unresolved: []
    })
    render(<Toaster />)
    show([screenshot, chat])
    fireEvent.click(await screen.findByRole('button', { name: 'Pick free ones' }))

    expect(await screen.findByText('Moved 2 hotkeys to free shortcuts')).toBeTruthy()
    expect(screen.getByText('Snap screen → question: Ctrl + Shift + 4')).toBeTruthy()
    expect(screen.getByText('Open chat window: Ctrl + Alt + Shift + R')).toBeTruthy()
    expect(pick).toHaveBeenCalledTimes(1)
  })

  it('says which hotkeys it could not move', async () => {
    stubPick({
      assigned: [{ action: 'screenshot', accelerator: 'Control+Shift+4' }],
      unresolved: [chat, hideShow]
    })
    render(<Toaster />)
    show([screenshot, chat, hideShow])
    fireEvent.click(await screen.findByRole('button', { name: 'Pick free ones' }))

    expect(await screen.findByText('Moved 1 hotkey to a free shortcut')).toBeTruthy()
    expect(
      await screen.findByText(
        'No free shortcut found for Open chat window, Toggle stealth. Set those yourself in Settings.'
      )
    ).toBeTruthy()
  })

  it('does not claim a move when nothing could be moved', async () => {
    stubPick({ assigned: [], unresolved: [chat] })
    render(<Toaster />)
    show([chat])
    fireEvent.click(await screen.findByRole('button', { name: 'Pick free ones' }))

    expect(
      await screen.findByText(
        'No free shortcut found for Open chat window. Set those yourself in Settings.'
      )
    ).toBeTruthy()
    expect(screen.queryByText(/Moved/)).toBeNull()
  })

  it('shows the error when picking fails', async () => {
    stubPick(
      new Error("Error invoking remote method 'settings:pick-free-hotkeys': Error: disk full")
    )
    render(<Toaster />)
    show([screenshot])
    fireEvent.click(await screen.findByRole('button', { name: 'Pick free ones' }))

    expect(await screen.findByText("Couldn't pick free hotkeys")).toBeTruthy()
    expect(await screen.findByText('disk full')).toBeTruthy()
  })
})
