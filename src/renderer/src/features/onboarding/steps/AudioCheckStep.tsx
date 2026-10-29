import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Loader2, Volume2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { meterStream } from '@renderer/audio/level'
import { useTranscript } from '@renderer/features/transcript/store'
import { enumerateMics, type MicDevice } from '@renderer/lib/audio'
import { errorMessage } from '@renderer/lib/errors'
import { cn } from '@renderer/lib/utils'
import type { StepProps } from '../types'
import { StepFooter } from './StepFooter'

type Source = 'mic' | 'system'
type ProbeState = 'starting' | 'listening' | 'heard' | 'quiet' | 'silent' | 'failed'

// Speech at laptop distance clears -30 dBFS easily; the test beeps reach the
// loopback well above -40 dBFS at any usable output volume.
const HEARD_PEAK: Record<Source, number> = { mic: 0.03, system: 0.01 }
// Same floor as level.ts: below it the device is delivering digital silence.
const SILENT_PEAK = 0.0003
const VERDICT_MS = 6_000
const METER_FLOOR_DB = -60

/** Peak amplitude → meter fill: -60 dBFS reads empty, 0 dBFS full. */
function meterLevel(peak: number): number {
  if (peak <= 0) return 0
  return Math.min(1, Math.max(0, 1 - (20 * Math.log10(peak)) / METER_FLOOR_DB))
}

async function openStream(source: Source, deviceId: string | null): Promise<MediaStream | null> {
  if (source === 'mic') {
    // Same constraints as the session's capture, so the check hears what a call would.
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { ideal: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
  }
  // Main answers display-media requests with the system loopback, no picker.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: 1, height: 1, frameRate: 1 },
    audio: true
  })
  for (const track of stream.getVideoTracks()) track.stop()
  const audio = stream.getAudioTracks()
  return audio.length > 0 ? new MediaStream(audio) : null
}

/** Three short beeps through the default output, for the loopback to catch. */
function playTestBeeps(): () => void {
  const ctx = new AudioContext()
  const start = ctx.currentTime + 0.15
  const notes = [660, 660, 880]
  notes.forEach((frequency, i) => {
    const at = start + i * 0.6
    const osc = new OscillatorNode(ctx, { frequency })
    const gain = new GainNode(ctx, { gain: 0 })
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + 0.35)
  })
  return () => void ctx.close().catch(() => {})
}

/**
 * Opens the source, drives the meter bar straight through `barRef` (no
 * re-render per frame), and settles on a verdict. Remount to re-run. The
 * device stays open for live feedback unless `closeWhenSettled`.
 */
function useLevelProbe(source: Source, deviceId: string | null, closeWhenSettled: boolean) {
  const barRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ProbeState>('starting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | null = null
    const close = (): void => {
      const done = release
      release = null
      done?.()
    }
    openStream(source, deviceId).then(
      (stream) => {
        if (cancelled) {
          for (const track of stream?.getTracks() ?? []) track.stop()
          return
        }
        if (!stream) {
          setState('failed')
          return
        }
        let loudest = 0
        let shown = 0
        let heard = false
        const stopMeter = meterStream(stream, (peak) => {
          // Fast attack, slow release: speech reads as a bar, not flicker.
          shown = Math.max(meterLevel(peak), shown * 0.92)
          if (barRef.current) barRef.current.style.transform = `scaleX(${shown})`
          loudest = Math.max(loudest, peak)
          if (!heard && loudest >= HEARD_PEAK[source]) {
            heard = true
            setState('heard')
            // Not inside the meter's own frame: it would reschedule after being stopped.
            if (closeWhenSettled) queueMicrotask(close)
          }
        })
        const stopBeeps = source === 'system' ? playTestBeeps() : null
        const verdict = setTimeout(() => {
          if (heard) return
          setState(loudest < SILENT_PEAK ? 'silent' : 'quiet')
          if (closeWhenSettled) close()
        }, VERDICT_MS)
        setState('listening')
        release = () => {
          clearTimeout(verdict)
          stopBeeps?.()
          stopMeter()
          for (const track of stream.getTracks()) track.stop()
        }
      },
      (err: unknown) => {
        if (cancelled) return
        console.warn(`[onboarding] ${source} audio check failed`, err)
        setError(errorMessage(err))
        setState('failed')
      }
    )
    return () => {
      cancelled = true
      close()
    }
  }, [source, deviceId, closeWhenSettled])

  return { state, error, barRef }
}

export function AudioCheckStep({ settings, update, goNext, goBack }: StepProps) {
  const { t } = useTranslation()
  // The check opens its own AudioContext; next to a live capture on the same
  // device that has silenced recordings on some Windows drivers.
  const sessionRunning = useTranscript((s) => s.session.kind === 'running')
  const [systemRun, setSystemRun] = useState(0)
  const micTitleId = useId()
  const micId = settings.audio.micDeviceId

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lead font-medium tracking-tight">{t('onboarding.audio.title')}</h2>
        <p className="mt-1 text-body leading-relaxed text-muted-foreground">
          {t('onboarding.audio.body')}
        </p>
      </div>

      {sessionRunning ? (
        <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-small text-warn">
          {t('onboarding.audio.session_running')}
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <Eyebrow id={micTitleId}>{t('onboarding.audio.mic_title')}</Eyebrow>
            <MicPicker
              labelledBy={micTitleId}
              value={micId}
              onChange={(id) => void update('audio', { ...settings.audio, micDeviceId: id })}
            />
            <Probe key={micId ?? 'default'} source="mic" deviceId={micId} />
          </section>

          <section className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <Eyebrow>{t('onboarding.audio.system_title')}</Eyebrow>
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div>
                <div className="text-body">{t('onboarding.audio.system_label')}</div>
                <div className="text-small text-muted-foreground">
                  {t('onboarding.audio.system_hint')}
                </div>
              </div>
              <Switch
                checked={settings.audio.systemEnabled}
                onCheckedChange={(v) =>
                  void update('audio', { ...settings.audio, systemEnabled: v })
                }
              />
            </label>
            {settings.audio.systemEnabled ? (
              <>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setSystemRun((n) => n + 1)}
                  >
                    <Volume2 className="size-3.5" />
                    {systemRun === 0
                      ? t('onboarding.audio.system_test')
                      : t('onboarding.audio.system_retest')}
                  </Button>
                </div>
                {systemRun > 0 && <Probe key={systemRun} source="system" deviceId={null} />}
              </>
            ) : (
              <p className="text-small text-muted-foreground">{t('onboarding.audio.system_off')}</p>
            )}
          </section>
        </>
      )}

      <StepFooter>
        <Button variant="ghost" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button onClick={goNext}>{t('common.next')}</Button>
      </StepFooter>
    </div>
  )
}

function Eyebrow({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="font-mono text-meta uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function MicPicker({
  labelledBy,
  value,
  onChange
}: {
  labelledBy: string
  value: string | null
  onChange(id: string | null): void
}) {
  const { t } = useTranslation()
  const [mics, setMics] = useState<MicDevice[]>([])
  // Device names only appear once mic access is granted, which the probe asks
  // for on mount — so the list is re-read whenever it opens.
  const refresh = (): void => {
    void enumerateMics().then(setMics, () => {})
  }
  useEffect(() => {
    void enumerateMics().then(setMics, () => {})
  }, [])
  return (
    <Select
      value={value ?? 'default'}
      onValueChange={(v) => onChange(v === 'default' ? null : v)}
      onOpenChange={(open) => {
        if (open) refresh()
      }}
    >
      <SelectTrigger aria-labelledby={labelledBy} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">{t('settings.audio.default_device')}</SelectItem>
        {mics.map((m) => (
          <SelectItem key={m.deviceId} value={m.deviceId}>
            {m.label || t('settings.audio.device_unnamed', { id: m.deviceId.slice(0, 8) })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function Probe({
  source,
  deviceId,
  closeWhenSettled = false
}: {
  source: Source
  deviceId: string | null
  closeWhenSettled?: boolean
}) {
  const { t } = useTranslation()
  const { state, error, barRef } = useLevelProbe(source, deviceId, closeWhenSettled)
  const passed = state === 'heard'
  const failed = state === 'quiet' || state === 'silent' || state === 'failed'
  // The loopback has no noise floor, so "quiet" and "silent" mean the same there.
  const messageState = source === 'system' && state === 'quiet' ? 'silent' : state
  return (
    <div className="flex flex-col gap-1.5">
      {state !== 'failed' && (
        <div aria-hidden className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            ref={barRef}
            className="h-full origin-left rounded-full bg-foreground/70"
            style={{ transform: 'scaleX(0)' }}
          />
          {/* Pass line: the bar has to cross it for the check to pass. */}
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${meterLevel(HEARD_PEAK[source]) * 100}%` }}
          />
        </div>
      )}
      <p
        aria-live="polite"
        className={cn(
          'flex items-start gap-1.5 text-small',
          passed ? 'text-success' : failed ? 'text-warn' : 'text-muted-foreground'
        )}
      >
        {passed ? (
          <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
        ) : failed ? (
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        ) : state === 'starting' ? (
          <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
        ) : null}
        <span>{t(`onboarding.audio.${source}_${messageState}`, { error })}</span>
      </p>
    </div>
  )
}
