import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import { DashboardApp } from './windows/dashboard/DashboardApp'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './styles/tailwind.css'

window.addEventListener('error', (e) => console.error('[window.error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('[unhandledrejection]', e.reason)
)

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DashboardApp />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
