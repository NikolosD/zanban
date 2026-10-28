export const queryKeys = {
  sessions: ['sessions-local'] as const,
  sessionDetail: (sessionId: string) => ['session-detail-local', sessionId] as const,
  recap: (sessionId: string) => ['recap', sessionId] as const,
  globalActionItems: ['global-action-items'] as const,
  followUps: (messageId: string) => ['follow-ups', messageId] as const,
  ragSearch: (query: string) => ['rag-search', query] as const
}
