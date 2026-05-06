import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import { ChatApp } from './windows/chat/ChatApp'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { initI18n, wireLocaleSync, type UiLocale } from './lib/i18n'
import './styles/tailwind.css'

window.addEventListener('error', (e) => console.error('[chat.error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('[chat.unhandledrejection]', e.reason)
)

initI18n('en')
void window.zanban.settings.get().then((s) => initI18n((s.uiLocale ?? 'en') as UiLocale))
wireLocaleSync()

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ChatApp />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
