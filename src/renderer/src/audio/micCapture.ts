import type { AudioChannel } from '@shared/types'
import { attachAnalyser } from './level'

const WORKLET_URL = '/audio/pcm-worklet.js'

interface CaptureHandle {
  stop(): void
}

interface StartArgs {
  channel: AudioChannel
  stream: MediaStream
  vad?: { enabled: boolean; threshold: number }
}

let workletReady: Promise<AudioContext> | null = null

function getContext(): Promise<AudioContext> {
  if (workletReady) return workletReady
  workletReady = (async () => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    await ctx.audioWorklet.addModule(WORKLET_URL)
    return ctx
  })()
  return workletReady
}

export async function startCapture({ channel, stream, vad }: StartArgs): Promise<CaptureHandle> {
  const ctx = await getContext()
  if (ctx.state === 'suspended') await ctx.resume()

  const detachAnalyser = channel === 'mic' ? attachAnalyser(stream) : () => {}
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-worklet')

  if (vad) {
    node.port.postMessage({
      vadEnabled: vad.enabled,
      vadThreshold: vad.threshold
    })
  }

  // Diagnostic: peak amplitude in first 10 chunks so we can confirm real audio.
  let count = 0
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (count < 10) {
      const view = new Int16Array(e.data)
      let peak = 0
      for (let i = 0; i < view.length; i++) {
        const v = Math.abs(view[i] ?? 0)
        if (v > peak) peak = v
      }
      const pct = Math.round((peak / 0x7fff) * 100)
      console.debug(
        `[audio:${channel}] chunk #${count}, peak=${peak}/32767 (${pct}%) ${pct < 1 ? '— SILENCE' : pct < 5 ? '— very quiet' : ''}`
      )
      count += 1
    }
    window.zanban.audio.sendChunk(channel, e.data)
  }

  // CRITICAL: must connect to destination for the worklet to actually process.
  // Use a muted gain so we don't hear ourselves.
  const silentGain = ctx.createGain()
  silentGain.gain.value = 0
  source.connect(node)
  node.connect(silentGain)
  silentGain.connect(ctx.destination)

  console.debug(
    `[audio:${channel}] capture started — ctx.sampleRate=${ctx.sampleRate}, state=${ctx.state}, tracks=${stream.getAudioTracks().length}`
  )

  return {
    stop() {
      try {
        detachAnalyser()
        node.port.close()
        node.disconnect()
        silentGain.disconnect()
        source.disconnect()
        for (const t of stream.getTracks()) t.stop()
      } catch {
        /* ignore */
      }
    }
  }
}

export async function startMic(
  deviceId?: string | null,
  vad?: { enabled: boolean; threshold: number }
): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { ideal: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  })
  return startCapture({ channel: 'mic', stream, vad })
}

export async function startSystem(vad?: {
  enabled: boolean
  threshold: number
}): Promise<CaptureHandle | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1, height: 1, frameRate: 1 },
      audio: true
    })
    // Drop video tracks — we only want the audio loopback.
    for (const t of stream.getVideoTracks()) t.stop()
    if (stream.getAudioTracks().length === 0) {
      return null
    }
    const audioOnly = new MediaStream(stream.getAudioTracks())
    return startCapture({ channel: 'system', stream: audioOnly, vad })
  } catch (err) {
    console.warn('[audio] system loopback unavailable', err)
    return null
  }
}
