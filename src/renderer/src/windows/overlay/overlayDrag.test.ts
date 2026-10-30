// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { shouldStartOverlayDrag } from './overlayDrag'

function target(html: string, selector: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.querySelector(selector)!
}

describe('shouldStartOverlayDrag', () => {
  it('starts on bare chrome with the left button', () => {
    expect(shouldStartOverlayDrag({ button: 0, target: target('<div id="x"></div>', '#x') })).toBe(
      true
    )
  })

  it('starts on plain text inside the chrome, like the transcript line', () => {
    const el = target('<div><p><span id="x">hello</span></p></div>', '#x')
    expect(shouldStartOverlayDrag({ button: 0, target: el })).toBe(true)
  })

  it('ignores the other mouse buttons', () => {
    const el = target('<div id="x"></div>', '#x')
    expect(shouldStartOverlayDrag({ button: 1, target: el })).toBe(false)
    expect(shouldStartOverlayDrag({ button: 2, target: el })).toBe(false)
  })

  it.each([
    ['button', '<button><svg id="x"></svg></button>'],
    ['link', '<a href="#"><span id="x">go</span></a>'],
    ['input', '<input id="x" />'],
    ['textarea', '<textarea id="x"></textarea>'],
    ['select', '<select id="x"></select>'],
    ['label', '<label><span id="x">a</span></label>'],
    ['resize handle', '<div role="separator"><span id="x"></span></div>'],
    ['menu', '<div role="menu"><div id="x"></div></div>'],
    ['menu item', '<div role="menuitem"><span id="x">a</span></div>'],
    ['popper', '<div data-radix-popper-content-wrapper=""><div id="x"></div></div>'],
    ['answer text', '<div data-no-drag><p><span id="x">const a = 1</span></p></div>']
  ])('does not start on a %s', (_name, html) => {
    expect(shouldStartOverlayDrag({ button: 0, target: target(html, '#x') })).toBe(false)
  })

  it('does not start without an element target', () => {
    expect(shouldStartOverlayDrag({ button: 0, target: null })).toBe(false)
    expect(shouldStartOverlayDrag({ button: 0, target: document })).toBe(false)
  })
})
