import type { ZanbanApi } from '@shared/api'

declare global {
  interface Window {
    zanban: ZanbanApi
  }
}

export {}
