import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import { ChatApp } from './windows/chat/ChatApp'
import { ErrorBoundary } from './lib/ErrorBoundary'
import './styles/tailwind.css'

window.addEventListener('error', (e) => console.error('[chat.error]', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('[chat.unhandledrejection]', e.reason)
)

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
