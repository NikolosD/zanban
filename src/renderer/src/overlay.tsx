import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import { OverlayApp } from './windows/overlay/OverlayApp'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './styles/tailwind.css'

window.addEventListener('error', (e) => console.error('[overlay.error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('[overlay.unhandledrejection]', e.reason)
)

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <OverlayApp />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
