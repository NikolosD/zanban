import { describe, expect, it } from 'vitest'
import { cleanPastedKey, detectKeyProvider, maskKey } from './keyProvider'

const filler = (n: number) => 'x'.repeat(n)

describe('detectKeyProvider', () => {
  it.each([
    ['anthropic', `sk-ant-api03-${filler(40)}`],
    ['anthropic', `sk-ant-admin01-${filler(40)}`],
    ['groq', `gsk_${filler(48)}`],
    ['vercel-gateway', `vck_${filler(40)}`],
    ['google-gemini', `AIza${filler(35)}`],
    ['openai', `sk-proj-${filler(60)}`],
    ['openai', `sk-svcacct-${filler(60)}`],
    ['openai', `sk-admin-${filler(60)}`],
    ['openai', `sk-${filler(20)}T3BlbkFJ${filler(20)}`],
    ['elevenlabs', `sk_${'a1'.repeat(24)}`],
    ['tavily', `tvly-${filler(32)}`],
    ['tavily', `tvly-dev-${filler(32)}`]
  ] as const)('recognizes a %s key', (provider, key) => {
    expect(detectKeyProvider(key)).toBe(provider)
  })

  it('looks past whitespace, newlines and quotes around the key', () => {
    const key = `gsk_${filler(48)}`
    expect(detectKeyProvider(`  ${key}\n`)).toBe('groq')
    expect(detectKeyProvider(`"${key}"`)).toBe('groq')
    expect(detectKeyProvider(`'${key}'`)).toBe('groq')
    expect(detectKeyProvider(`\`${key}\``)).toBe('groq')
    expect(detectKeyProvider(`“${key}”`)).toBe('groq')
    expect(detectKeyProvider(` "${key}" \r\n`)).toBe('groq')
  })

  it('does not mistake an Anthropic key for an OpenAI one', () => {
    expect(detectKeyProvider(`sk-ant-api03-${filler(40)}`)).not.toBe('openai')
  })

  it('does not guess for a bare sk- key, which several providers share', () => {
    expect(detectKeyProvider(`sk-${filler(48)}`)).toBeNull()
    expect(detectKeyProvider(`sk-${'a1'.repeat(16)}`)).toBeNull()
  })

  it('does not guess for providers whose keys have no distinctive prefix', () => {
    expect(detectKeyProvider('0123456789abcdef0123456789abcdef01234567')).toBeNull()
    expect(detectKeyProvider(`sk-or-v1-${filler(48)}`)).toBeNull()
    expect(detectKeyProvider(`xai-${filler(48)}`)).toBeNull()
  })

  it('does not guess for text that is not a key', () => {
    expect(detectKeyProvider('')).toBeNull()
    expect(detectKeyProvider('   \n')).toBeNull()
    expect(detectKeyProvider('hello world')).toBeNull()
    expect(detectKeyProvider('""')).toBeNull()
    expect(detectKeyProvider('{"type":"service_account"}')).toBeNull()
  })

  it('waits for a whole key rather than reacting to a typed prefix', () => {
    expect(detectKeyProvider('gsk_')).toBeNull()
    expect(detectKeyProvider('sk-ant-')).toBeNull()
    expect(detectKeyProvider('AIza')).toBeNull()
  })

  it('requires the prefix at the very start, in its exact case', () => {
    expect(detectKeyProvider(`my gsk_${filler(48)}`)).toBeNull()
    expect(detectKeyProvider(`GROQ=gsk_${filler(48)}`)).toBeNull()
    expect(detectKeyProvider(`GSK_${filler(48)}`)).toBeNull()
    expect(detectKeyProvider(`aiza${filler(35)}`)).toBeNull()
  })

  it('rejects a value that has whitespace inside', () => {
    expect(detectKeyProvider(`gsk_${filler(20)} ${filler(20)}`)).toBeNull()
    expect(detectKeyProvider(`gsk_${filler(20)}\n${filler(20)}`)).toBeNull()
  })

  it('keeps ElevenLabs to its hex shape so an unrelated sk_ value is left alone', () => {
    expect(detectKeyProvider(`sk_${filler(48)}`)).toBeNull()
    expect(detectKeyProvider(`sk_${'a1'.repeat(8)}`)).toBeNull()
  })
})

describe('cleanPastedKey', () => {
  it('strips surrounding whitespace and quote characters', () => {
    expect(cleanPastedKey('  abc123  ')).toBe('abc123')
    expect(cleanPastedKey('"abc123"')).toBe('abc123')
    expect(cleanPastedKey("'abc123'")).toBe('abc123')
    expect(cleanPastedKey('`abc123`')).toBe('abc123')
    expect(cleanPastedKey('“abc123”')).toBe('abc123')
    expect(cleanPastedKey('\n "abc123"\t')).toBe('abc123')
    expect(cleanPastedKey('" abc123 "')).toBe('abc123')
  })

  it('leaves the key itself untouched', () => {
    expect(cleanPastedKey('sk-ant-api03-Ab_c-D')).toBe('sk-ant-api03-Ab_c-D')
    expect(cleanPastedKey('')).toBe('')
  })
})

describe('maskKey', () => {
  it('shows only the last four characters, like a saved key does', () => {
    const key = `gsk_${filler(40)}wxyz`
    const mask = maskKey(key)
    expect(mask).toBe('••••wxyz')
    expect(mask).not.toContain('gsk_')
  })

  it('shows no tail at all for a value too short to hide it', () => {
    expect(maskKey('abcd1234')).toBe('••••')
  })
})
