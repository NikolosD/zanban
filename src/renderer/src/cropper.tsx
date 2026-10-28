import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CropperApp } from './windows/cropper/CropperApp'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { initI18n, type UiLocale } from './lib/i18n'
import './styles/tailwind.css'

window.addEventListener('error', (e) => console.error('[cropper.error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('[cropper.unhandledrejection]', e.reason)
)

initI18n('en')
void window.zanban.settings.get().then((s) => initI18n((s.uiLocale ?? 'en') as UiLocale))

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <CropperApp />
    </ErrorBoundary>
  </StrictMode>
)
