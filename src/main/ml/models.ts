// Whisper-tiny is the smallest supported variant (~70 MB).
// Trade quality for footprint — Privacy Mode users opt in knowingly.
export const WHISPER_MODEL = 'Xenova/whisper-tiny'

/** Multilingual (50+ languages incl. Russian) sentence encoder, 384-dim, ONNX. */
export const LOCAL_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
// Pinned so an upstream re-export can't silently change the vectors already stored.
export const LOCAL_EMBEDDING_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900'

const PARAKEET_REPO =
  'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78'
const VAD_REPO =
  'https://huggingface.co/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc'

/** NVIDIA Parakeet TDT 0.6B v3 (int8 sherpa-onnx export) plus the Silero VAD that cuts its input. */
export const PARAKEET_DIR = 'parakeet-tdt-0.6b-v3-int8'
// Pinned by revision and checksum: ~670 MB is too much to load unverified.
export const PARAKEET_FILES = [
  {
    name: 'encoder.int8.onnx',
    url: `${PARAKEET_REPO}/encoder.int8.onnx`,
    sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247'
  },
  {
    name: 'decoder.int8.onnx',
    url: `${PARAKEET_REPO}/decoder.int8.onnx`,
    sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e'
  },
  {
    name: 'joiner.int8.onnx',
    url: `${PARAKEET_REPO}/joiner.int8.onnx`,
    sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3'
  },
  {
    name: 'tokens.txt',
    url: `${PARAKEET_REPO}/tokens.txt`,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d'
  },
  {
    name: 'silero_vad.onnx',
    url: `${VAD_REPO}/silero_vad.onnx`,
    sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28'
  }
]

/**
 * Speech languages Parakeet v3 covers; 'multi' is its own language detection.
 * Anything else stays on Whisper.
 */
export const PARAKEET_LANGUAGES = new Set([
  'multi',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'hr',
  'hu',
  'it',
  'lt',
  'lv',
  'mt',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'uk'
])
