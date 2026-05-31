/**
 * Single source of truth for audio-capture / VAD tuning. Shared between the
 * renderer capture path (`micCapture`) and the settings defaults so the worklet
 * never disagrees with what the UI thinks it configured.
 *
 * NOTE: `public/audio/pcm-worklet.js` is a static AudioWorklet module that can't
 * import from `src/`. It mirrors these values as literals — keep them in sync
 * (the worklet only falls back to its own literals if no config message is sent,
 * which `micCapture` now always sends).
 */

/** ~100ms batch at 16kHz mono (1600 samples). */
export const VAD_BATCH_SIZE = 1600

/**
 * RMS threshold in [0,1] for the energy-gated VAD. 0.005 ≈ -46 dBFS — quiet but
 * real speech still passes. Lower = more permissive (less chance of silently
 * dropping a soft-spoken mic). This is the default; the user can tune it.
 */
export const VAD_DEFAULT_THRESHOLD = 0.005

/**
 * Number of sub-threshold batches kept streaming after the last detected speech
 * batch, so we don't clip the tail of words. 6 ≈ 600ms.
 */
export const VAD_HANGOVER_BATCHES = 6
