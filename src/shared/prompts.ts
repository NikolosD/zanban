/**
 * User-facing prompt strings shared by main and renderer. Single source of
 * truth — keep edits here so the overlay's "Answer last" button and any
 * other caller see the same text.
 */

export const ANSWER_LAST_PROMPT =
  'Look at the recent transcript. Find the most recent question asked by THEM (the other speaker, not YOU). Answer that question directly and concisely as if YOU were answering live in the meeting. 3-5 short bullets or 1-2 sentences max. No preamble. Match the question language.'

export const SCREENSHOT_DEFAULT_PROMPT =
  'Help me with what is on this screenshot — solve it, fix it, or do whatever it asks for. Skip describing the image.'

export const FOLLOW_UP_PROMPT =
  'Based on the previous answer, suggest 2-3 sharp follow-up questions I should ask. Output as a short bullet list, no preamble.'

export const RECAP_PROMPT =
  'Recap what was discussed in the last 90 seconds of this meeting. 3-5 short bullets. No preamble.'

export const WHAT_TO_ANSWER_PROMPT =
  'Based on what was just said in this meeting, what is the single most important question I should answer right now? State the question in one short line, no preamble.'

export const SHORTEN_PROMPT =
  'Take the previous answer and rewrite it 2-3x shorter without losing key information. No preamble.'
