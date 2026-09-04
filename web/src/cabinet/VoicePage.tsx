import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { SkipTtsOnLinkIssueSetting } from '@/cabinet/SkipTtsOnLinkIssueSetting'
import { CaptionsFromTtsSetting } from '@/cabinet/CaptionsFromTtsSetting'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  fetchProjectVoice,
  saveProjectVoice,
  type ProjectVoice,
  type TtsProviderInfo,
  type TtsVoiceOption,
} from '@/lib/api'
import { generateTts } from '@/lib/ttsGenerate'
import { ttsPlaybackUrl } from '@/lib/ttsUrl'
import { cn } from '@/lib/utils'

const FALLBACK_DEMO_TEXT =
  'Здравствуйте! Мы подготовили для вас персональную презентацию.'

function voices24k(voices: TtsVoiceOption[]) {
  return voices.filter((item) => !item.id.endsWith('_8000'))
}

function voiceList(providerId: TtsProviderInfo['id'], voices: TtsVoiceOption[]) {
  return providerId === 'sber' ? voices24k(voices) : voices
}

function enabledVoices(voices: TtsVoiceOption[]) {
  const ok = voices.filter((item) => item.available !== false)
  return ok.length ? ok : voices
}

function normalizeVoice(voiceId: string, voices: TtsVoiceOption[], providerId: TtsProviderInfo['id']) {
  const list = enabledVoices(voices)
  if (list.some((item) => item.id === voiceId)) return voiceId
  if (providerId === 'sber') {
    const upgraded = voiceId.replace(/_8000$/, '_24000')
    if (list.some((item) => item.id === upgraded)) return upgraded
  }
  return list[0]?.id ?? voiceId
}

export function VoicePage() {
  const { code } = useParams()
  const { project, reloadProjects } = useOutletContext<CabinetOutlet>()
  const projectCode = code || project?.code || ''
  const [data, setData] = useState<ProjectVoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<TtsProviderInfo['id']>('elevenlabs')
  const [voice, setVoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [demoVoiceId, setDemoVoiceId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const demoSeq = useRef(0)

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    void fetchProjectVoice(projectCode)
      .then((next) => {
        if (cancelled) return
        const providerIds = new Set(next.providers.map((item) => item.id))
        const resolvedProvider = providerIds.has(next.provider)
          ? next.provider
          : (next.providers[0]?.id ?? 'elevenlabs')
        const activeProvider =
          next.providers.find((item) => item.id === resolvedProvider) ?? next.providers[0]
        const list = voiceList(resolvedProvider, activeProvider?.voices ?? [])
        const normalizedVoice = normalizeVoice(next.voice, list, resolvedProvider)
        setData(next)
        setProvider(resolvedProvider)
        setVoice(normalizedVoice)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось загрузить настройки голоса')
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectCode])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const stopDemo = useCallback(() => {
    audioRef.current?.pause()
    setDemoVoiceId(null)
  }, [])

  const playDemo = useCallback(
    async (voiceId: string, providerId: TtsProviderInfo['id'], demoSrc?: string) => {
      if (!voiceId || !projectCode) return
      const seq = ++demoSeq.current
      stopDemo()
      setDemoVoiceId(voiceId)
      try {
        const audio = audioRef.current ?? new Audio()
        audioRef.current = audio
        audio.onended = () => setDemoVoiceId(null)
        audio.onerror = () => {
          if (seq !== demoSeq.current) return
          setDemoVoiceId(null)
          toast.error('Не удалось проиграть пример голоса')
        }

        if (demoSrc) {
          audio.src = demoSrc
          audio.currentTime = 0
          await audio.play()
          return
        }

        const saved = data?.provider === providerId && data?.voice === voiceId
        if (!saved) {
          const next = await saveProjectVoice(projectCode, providerId, voiceId)
          if (seq !== demoSeq.current) return
          setData(next)
          setProvider(next.provider)
          setVoice(next.voice)
        }

        const result = await generateTts(FALLBACK_DEMO_TEXT, { projectCode })
        if (seq !== demoSeq.current) return
        audio.src = ttsPlaybackUrl(result.src)
        audio.currentTime = 0
        await audio.play()
      } catch (err) {
        if (seq !== demoSeq.current) return
        setDemoVoiceId(null)
        toast.error(err instanceof Error ? err.message : 'Не удалось озвучить пример')
      }
    },
    [data?.provider, data?.voice, projectCode, stopDemo],
  )

  const active = data?.providers.find((item) => item.id === provider) ?? data?.providers[0]
  const voices = active ? voiceList(provider, active.voices) : []
  const dirty = data ? provider !== data.provider || voice !== data.voice : false
  const showProviderPicker = (data?.providers.length ?? 0) > 1

  const pickProvider = (nextId: string) => {
    if (!data) return
    const next = data.providers.find((item) => item.id === nextId)
    if (!next) return
    const list = voiceList(next.id, next.voices)
    if (list.length === 0) return
    const nextVoice = normalizeVoice(
      list.some((item) => item.id === voice) ? voice : voice.replace(/_8000$/, '_24000'),
      list,
      next.id,
    )
    setProvider(next.id)
    setVoice(nextVoice)
  }

  const pickVoice = (nextId: string) => {
    if (!nextId || nextId === voice) return
    const picked = voices.find((item) => item.id === nextId)
    if (picked?.available === false) return
    setVoice(nextId)
    void playDemo(nextId, provider, picked?.demoSrc)
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveProjectVoice(projectCode, provider, voice)
      setData(next)
      setProvider(next.provider)
      setVoice(normalizeVoice(next.voice, voices, next.provider))
      toast.success(`Голос: ${next.label}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить голос')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      {projectCode ? (
        <>
          <SkipTtsOnLinkIssueSetting
            projectCode={projectCode}
            enabled={Boolean(project?.skipTtsOnLinkIssue)}
            onUpdated={() => void reloadProjects()}
          />
          <CaptionsFromTtsSetting
            projectCode={projectCode}
            enabled={Boolean(project?.captionsFromTts)}
            onUpdated={() => void reloadProjects()}
          />
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Кто озвучивает титры</CardTitle>
          <CardDescription>
            Голос применяется ко всем новым генерациям в конструкторе. Уже озвученные титры
            остаются как есть, пока их не сгенерировать заново.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {error && !data ? <p className="text-destructive text-sm">{error}</p> : null}
          {!data ? (
            <p className="text-muted-foreground text-sm">Загрузка настроек голоса…</p>
          ) : (
            <>
              {showProviderPicker ? (
                <FieldSet>
                  <FieldLegend>Сервис</FieldLegend>
                  <FieldDescription>ElevenLabs.</FieldDescription>
                  <RadioGroup
                    value={provider}
                    onValueChange={(next) => pickProvider(String(next ?? ''))}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    {data.providers.map((item) => {
                      const list = voiceList(item.id, item.voices)
                      const empty = list.length === 0
                      const inputId = `provider-${item.id}`
                      return (
                        <FieldLabel key={item.id} htmlFor={inputId} className={empty ? 'opacity-60' : undefined}>
                          <Field orientation="horizontal">
                            <FieldContent>
                              <div className="font-medium">{item.name}</div>
                              <FieldDescription>{item.note}</FieldDescription>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {item.id === data.provider ? (
                                  <Badge variant="secondary">Сохранено</Badge>
                                ) : null}
                                {item.configured ? null : (
                                  <Badge variant="outline">Нет ключа в .env</Badge>
                                )}
                                {empty ? <Badge variant="outline">Голоса не заданы</Badge> : null}
                              </div>
                            </FieldContent>
                            <RadioGroupItem value={item.id} id={inputId} disabled={empty} />
                          </Field>
                        </FieldLabel>
                      )
                    })}
                  </RadioGroup>
                </FieldSet>
              ) : null}

              <FieldSet>
                <FieldLegend>Голос</FieldLegend>
                <FieldDescription>
                  {active?.voices.some((v) => v.demoSrc)
                    ? provider === 'sber'
                      ? 'Выберите голос — проиграем официальный пример с сайта Сбера.'
                      : 'Выберите голос — проиграем короткий пример озвучки.'
                    : provider === 'elevenlabs' || !showProviderPicker
                      ? 'Выберите голос — сгенерируем короткий пример (Eleven v3).'
                      : active?.configured
                        ? 'Выберите голос — сгенерируем короткий пример.'
                        : 'Сервис не настроен: добавьте ключ в .env.'}
                </FieldDescription>
                {voices.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Для этого сервиса голоса не заданы.</p>
                ) : (
                  <RadioGroup
                    value={voice}
                    onValueChange={(next) => pickVoice(String(next ?? ''))}
                    className="grid max-w-md gap-2"
                  >
                    {voices.map((item) => {
                      const inputId = `voice-${item.id}`
                      const busy = demoVoiceId === item.id
                      const disabled = item.available === false
                      const busyLabel = item.demoSrc ? ' · слушаем…' : ' · готовим пример…'
                      return (
                        <FieldLabel
                          key={item.id}
                          htmlFor={inputId}
                          className={disabled ? 'opacity-50' : undefined}
                        >
                          <Field orientation="horizontal">
                            <FieldContent>
                              <div className={cn('font-medium', (busy || disabled) && 'text-muted-foreground')}>
                                {item.name}
                                {busy ? busyLabel : null}
                              </div>
                              {disabled ? (
                                <FieldDescription>Пример пока недоступен</FieldDescription>
                              ) : item.label !== item.name ? (
                                <FieldDescription>{item.label}</FieldDescription>
                              ) : null}
                            </FieldContent>
                            <RadioGroupItem value={item.id} id={inputId} disabled={disabled} />
                          </Field>
                        </FieldLabel>
                      )
                    })}
                  </RadioGroup>
                )}
              </FieldSet>

              {dirty ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={() => void save()} disabled={saving || !voice}>
                    {saving ? 'Сохранение…' : 'Сохранить голос'}
                  </Button>
                  <span className="text-muted-foreground text-sm">
                    {showProviderPicker
                      ? 'Сменили сервис — сохраните или выберите голос для прослушивания.'
                      : 'Выберите голос для прослушивания или нажмите «Сохранить голос».'}
                  </span>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Сейчас: {data.label}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
