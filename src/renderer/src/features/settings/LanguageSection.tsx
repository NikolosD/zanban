import { Trans, useTranslation } from 'react-i18next'
import { RESPONSE_LANGUAGES, type AppSettings, type ResponseLanguage } from '@shared/types'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Field, Section, TabLink } from './layout'
import {
  recapAfterAnswersChange,
  recapFollowsAnswers,
  recapLanguageFor,
  type RecapLanguage
} from './languages'

const SPEECH_POPULAR = ['multi', 'en', 'ru', 'es', 'de', 'fr']
const SPEECH_OTHER = ['it', 'pt', 'nl', 'pl', 'tr', 'uk', 'ja', 'ko', 'zh', 'hi', 'ar']
const RECAP_LANGUAGES: RecapLanguage[] = ['auto', 'en', 'ru']
const SAME_AS_ANSWERS = '__answers__'

interface Props {
  settings: AppSettings
  update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void
  onOpenKeys(): void
}

/** Every language setting in one place: interface, speech, answers, recap. */
export function LanguageSection({ settings, update, onOpenKeys }: Props) {
  const { t } = useTranslation()
  const sttName = t(`settings.providers.stt.${settings.sttProvider}.name`)
  // Deepgram streams multilingual natively and Whisper detects per utterance;
  // the other engines need one fixed language.
  const supportsMulti =
    settings.sttProvider === 'deepgram' || settings.sttProvider === 'openai-whisper'
  const speechLabel = (v: string): string =>
    t(`settings.transcription.lang.${v}`, { defaultValue: v })

  const followRecap = recapLanguageFor(settings.responseLanguage)
  const recapValue = recapFollowsAnswers(settings) ? SAME_AS_ANSWERS : settings.recap.language

  function setAnswers(next: ResponseLanguage): void {
    update('responseLanguage', next)
    const recap = recapAfterAnswersChange(settings, next)
    if (recap !== settings.recap) update('recap', recap)
  }

  function setRecap(value: string): void {
    const language = value === SAME_AS_ANSWERS ? followRecap : (value as RecapLanguage)
    update('recap', { ...settings.recap, language })
  }

  return (
    <Section title={t('settings.language.title')} hint={t('settings.language.hint')}>
      <Field
        label={t('settings.language.interface_label')}
        hint={t('settings.language.interface_hint')}
      >
        {(control) => (
          <Select
            value={settings.uiLocale ?? 'en'}
            onValueChange={(v) => update('uiLocale', v as AppSettings['uiLocale'])}
          >
            <SelectTrigger {...control} className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ru">Русский</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field
        label={t('settings.language.speech_label')}
        hint={
          supportsMulti
            ? t('settings.transcription.hint_multi')
            : t('settings.transcription.hint_single', { provider: sttName })
        }
      >
        {(control) => (
          <div className="flex flex-col gap-1.5">
            <Select
              value={settings.transcriptionLanguage}
              onValueChange={(v) => update('transcriptionLanguage', v)}
            >
              <SelectTrigger {...control} className="w-64">
                <SelectValue>{speechLabel(settings.transcriptionLanguage)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('settings.transcription.popular')}</SelectLabel>
                  {SPEECH_POPULAR.filter((v) => v !== 'multi' || supportsMulti).map((v) => (
                    <SelectItem key={v} value={v}>
                      {speechLabel(v)}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t('settings.transcription.other')}</SelectLabel>
                  {SPEECH_OTHER.map((v) => (
                    <SelectItem key={v} value={v}>
                      {speechLabel(v)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-small text-muted-foreground">
              <Trans
                i18nKey="settings.transcription.switch_provider_note"
                values={{ provider: sttName }}
                components={{ 0: <TabLink onClick={onOpenKeys} /> }}
              />
            </p>
          </div>
        )}
      </Field>

      <Field
        label={t('settings.language.answers_label')}
        hint={t('settings.language.answers_hint')}
      >
        {(control) => (
          <Select
            value={settings.responseLanguage ?? 'auto'}
            onValueChange={(v) => setAnswers(v as ResponseLanguage)}
          >
            <SelectTrigger {...control} className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESPONSE_LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {t(`settings.response_languages.${l.value}`, { defaultValue: l.label })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field label={t('settings.language.recap_label')} hint={t('settings.language.recap_hint')}>
        {(control) => (
          <Select value={recapValue} onValueChange={setRecap}>
            <SelectTrigger {...control} className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SAME_AS_ANSWERS}>{t('settings.language.recap_same')}</SelectItem>
              {/* The option "same as answers" already resolves to is left out. */}
              {RECAP_LANGUAGES.filter((l) => l !== followRecap).map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`settings.recap.languages.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
    </Section>
  )
}
