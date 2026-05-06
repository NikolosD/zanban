import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import { DashboardApp } from './windows/dashboard/DashboardApp'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { initI18n, wireLocaleSync, type UiLocale } from './lib/i18n'
import './styles/tailwind.css'

window.addEventListener('error', (e) => console.error('[window.error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('[unhandledrejection]', e.reason)
)

// Initialize i18n with the English fallback synchronously so the first paint
// has translations available, then upgrade to the user's saved locale once
// settings come back from main. The renderer entry points all do this — it's
// idempotent (initI18n re-uses the singleton on second call).
initI18n('en')
void window.zanban.settings.get().then((s) => initI18n((s.uiLocale ?? 'en') as UiLocale))
wireLocaleSync()

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
