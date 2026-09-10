import { useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { toast } from 'sonner'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
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
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  fetchAdminIntegrations,
  saveAdminIntegrations,
  type AdminAssemblyProvider,
  type AdminIntegrationProvider,
  type AdminTranscribeProvider,
} from '@/lib/api'

function sourceLabel(source: AdminIntegrationProvider['source'] | undefined) {
  if (source === 'database') return 'из админки'
  if (source === 'env') return 'из .env'
  return 'не задан'
}

function IntegrationCard({
  item,
  draft,
  folderDraft,
  onDraft,
  onFolderDraft,
  onSave,
  onClear,
  onSaveFolder,
  pending,
}: {
  item: AdminIntegrationProvider
  draft: string
  folderDraft: string
  onDraft: (value: string) => void
  onFolderDraft: (value: string) => void
  onSave: () => void
  onClear: () => void
  onSaveFolder: () => void
  pending: boolean
}) {
  const disabled = item.comingSoon || pending
  const isYandex = item.id === 'yandex'
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{item.label}</CardTitle>
          {item.comingSoon ? <Badge variant="secondary">скоро</Badge> : null}
          {!item.comingSoon && item.hasKey ? (
            <Badge variant="outline">{sourceLabel(item.source)}</Badge>
          ) : null}
        </div>
        <CardDescription>
          {item.comingSoon
            ? 'Подключим позже — поле пока недоступно.'
            : item.keyHint
              ? `Текущий ключ: ${item.keyHint}`
              : item.hasKey
                ? 'Ключ задан на сервере (.env), можно переопределить здесь.'
                : 'Вставьте API key сервиса.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field>
          <FieldLabel htmlFor={`api-key-${item.id}`}>API key</FieldLabel>
          <FieldContent>
            <Input
              id={`api-key-${item.id}`}
              type="password"
              autoComplete="off"
              placeholder={item.hasKey ? '••••••••••••' : 'sk-… / AIza… / AQVN…'}
              value={draft}
              disabled={disabled}
              onChange={(event) => onDraft(event.target.value)}
            />
            <FieldDescription>Полный ключ в интерфейс не возвращается.</FieldDescription>
          </FieldContent>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={disabled || !draft.trim()} onClick={onSave}>
            Сохранить ключ
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || item.source !== 'database'}
            onClick={onClear}
          >
            Сбросить ключ админки
          </Button>
        </div>

        {isYandex ? (
          <Field>
            <FieldLabel htmlFor="yandex-folder-id">Folder ID каталога</FieldLabel>
            <FieldContent>
              <Input
                id="yandex-folder-id"
                autoComplete="off"
                placeholder="b1g…"
                value={folderDraft !== '' ? folderDraft : item.folderId || ''}
                disabled={disabled}
                onChange={(event) => onFolderDraft(event.target.value)}
              />
              <FieldDescription>
                Обязателен для YandexGPT (сводка/сборка). Сейчас:{' '}
                {item.hasFolderId ? (
                  <>
                    {sourceLabel(item.folderIdSource)}
                    {item.folderId ? ` · ${item.folderId}` : ''}
                  </>
                ) : (
                  <span className="text-destructive">не задан — сводка не запустится</span>
                )}
                . Взять в консоли Yandex Cloud → каталог → идентификатор.
              </FieldDescription>
              <Button
                type="button"
                size="sm"
                className="mt-2"
                disabled={disabled || !(folderDraft !== '' ? folderDraft : item.folderId || '').trim()}
                onClick={onSaveFolder}
              >
                Сохранить folder id
              </Button>
            </FieldContent>
          </Field>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function AdminApiPage() {
  const { user } = useOutletContext<CabinetOutlet>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [transcribeProvider, setTranscribeProvider] = useState('gemini')
  const [transcribeProviders, setTranscribeProviders] = useState<AdminTranscribeProvider[]>([])
  const [assemblyProvider, setAssemblyProvider] = useState('gemini')
  const [assemblyProviders, setAssemblyProviders] = useState<AdminAssemblyProvider[]>([])
  const [integrations, setIntegrations] = useState<AdminIntegrationProvider[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [folderDraft, setFolderDraft] = useState('')

  const applyOverview = (data: Awaited<ReturnType<typeof fetchAdminIntegrations>>) => {
    setTranscribeProvider(data.transcribeProvider)
    setTranscribeProviders(data.transcribeProviders)
    setAssemblyProvider(data.assemblyProvider || 'gemini')
    setAssemblyProviders(data.assemblyProviders || [])
    setIntegrations(data.integrations)
  }

  const reload = () => {
    setLoading(true)
    void fetchAdminIntegrations()
      .then((data) => {
        applyOverview(data)
        setDrafts({})
        setFolderDraft('')
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  if (!user.isAdmin) {
    return <Navigate to="/app" replace />
  }

  const saveTranscribeProvider = async (next: string) => {
    const prev = transcribeProvider
    setTranscribeProvider(next)
    setPending(true)
    try {
      const data = await saveAdminIntegrations({ transcribeProvider: next })
      applyOverview(data)
      toast.success('Провайдер транскрибации сохранён')
    } catch (err) {
      setTranscribeProvider(prev)
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setPending(false)
    }
  }

  const saveAssemblyProvider = async (next: string) => {
    const prev = assemblyProvider
    setAssemblyProvider(next)
    setPending(true)
    try {
      const data = await saveAdminIntegrations({ assemblyProvider: next })
      applyOverview(data)
      toast.success('Провайдер сборки сохранён')
    } catch (err) {
      setAssemblyProvider(prev)
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setPending(false)
    }
  }

  const saveSecret = async (id: string) => {
    const value = String(drafts[id] ?? '').trim()
    if (!value) return
    setPending(true)
    try {
      const data = await saveAdminIntegrations({ secrets: { [id]: value } })
      applyOverview(data)
      setDrafts((prev) => ({ ...prev, [id]: '' }))
      toast.success('Ключ сохранён')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить ключ')
    } finally {
      setPending(false)
    }
  }

  const clearSecret = async (id: string) => {
    setPending(true)
    try {
      const data = await saveAdminIntegrations({ secrets: { [id]: '' } })
      applyOverview(data)
      setDrafts((prev) => ({ ...prev, [id]: '' }))
      toast.success('Ключ админки сброшен')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сбросить ключ')
    } finally {
      setPending(false)
    }
  }

  const saveFolderId = async () => {
    const yandex = integrations.find((item) => item.id === 'yandex')
    const value = String(folderDraft || yandex?.folderId || '').trim()
    setPending(true)
    try {
      const data = await saveAdminIntegrations({ configs: { yandexFolderId: value } })
      applyOverview(data)
      setFolderDraft('')
      toast.success(value ? 'Folder id сохранён' : 'Folder id сброшен')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить folder id')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="font-sans text-xl font-semibold tracking-tight">API</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Внешние сервисы платформы: ключи и выбор провайдера. Ключи из админки перекрывают .env.
        </p>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {loading ? <p className="text-muted-foreground text-sm">Загрузка…</p> : null}

      {!loading ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Транскрибация</CardTitle>
              <CardDescription>Какой сервис использовать для расшифровки звонков.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldSet>
                <FieldLegend className="sr-only">Провайдер транскрибации</FieldLegend>
                <RadioGroup
                  value={transcribeProvider}
                  disabled={pending}
                  onValueChange={(value) => {
                    void saveTranscribeProvider(String(value ?? ''))
                  }}
                  className="gap-3"
                >
                  {transcribeProviders.map((item) => (
                    <Field key={item.id} orientation="horizontal">
                      <RadioGroupItem
                        value={item.id}
                        id={`transcribe-${item.id}`}
                        disabled={!item.available || pending}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={`transcribe-${item.id}`} className="font-normal">
                          {item.label}
                          {!item.available ? (
                            <Badge variant="secondary" className="ml-2">
                              скоро
                            </Badge>
                          ) : null}
                        </FieldLabel>
                      </FieldContent>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Сборка (сводка)</CardTitle>
              <CardDescription>
                Кто извлекает параметры гостя из транскриптов для адаптивной сборки.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldSet>
                <FieldLegend className="sr-only">Провайдер сборки</FieldLegend>
                <RadioGroup
                  value={assemblyProvider}
                  disabled={pending}
                  onValueChange={(value) => {
                    void saveAssemblyProvider(String(value ?? ''))
                  }}
                  className="gap-3"
                >
                  {assemblyProviders.map((item) => (
                    <Field key={item.id} orientation="horizontal">
                      <RadioGroupItem
                        value={item.id}
                        id={`assembly-${item.id}`}
                        disabled={!item.available || pending}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={`assembly-${item.id}`} className="font-normal">
                          {item.label}
                          {!item.available ? (
                            <Badge variant="secondary" className="ml-2">
                              скоро
                            </Badge>
                          ) : null}
                        </FieldLabel>
                      </FieldContent>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {integrations.map((item) => (
              <IntegrationCard
                key={item.id}
                item={item}
                draft={drafts[item.id] ?? ''}
                folderDraft={folderDraft}
                pending={pending}
                onDraft={(value) => setDrafts((prev) => ({ ...prev, [item.id]: value }))}
                onFolderDraft={setFolderDraft}
                onSave={() => void saveSecret(item.id)}
                onClear={() => void clearSecret(item.id)}
                onSaveFolder={() => void saveFolderId()}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
