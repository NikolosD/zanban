import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CropperApp } from './windows/cropper/CropperApp'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './styles/tailwind.css'

window.addEventListener('error', (e) => console.error('[cropper.error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('[cropper.unhandledrejection]', e.reason)
)

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <CropperApp />
    </ErrorBoundary>
  </StrictMode>
)
