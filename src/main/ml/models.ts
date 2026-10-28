// Whisper-tiny is the smallest supported variant (~70 MB).
// Trade quality for footprint — Privacy Mode users opt in knowingly.
export const WHISPER_MODEL = 'Xenova/whisper-tiny'

/** Multilingual (50+ languages incl. Russian) sentence encoder, 384-dim, ONNX. */
export const LOCAL_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
// Pinned so an upstream re-export can't silently change the vectors already stored.
export const LOCAL_EMBEDDING_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900'
