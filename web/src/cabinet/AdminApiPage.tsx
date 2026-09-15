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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  addAdminElevenlabsKey,
  deleteAdminElevenlabsKey,
  fetchAdminIntegrations,
  saveAdminIntegrations,
  selectAdminElevenlabsKey,
  testAdminIntegration,
  type AdminAssemblyProvider,
  type AdminExtractModel,
  type AdminIntegrationProvider,
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
  labelDraft,
  onDraft,
  onFolderDraft,
  onLabelDraft,
  onSave,
  onClear,
  onSaveFolder,
  onClearFolder,
  onAddElevenKey,
  onSelectElevenKey,
  onDeleteElevenKey,
  onTest,
  pendingSecret,
  pendingClear,
  pendingFolder,
  pendingTest,
  pendingSelectId,
  pendingDeleteId,
}: {
  item: AdminIntegrationProvider
  draft: string
  folderDraft: string
  labelDraft: string
  onDraft: (value: string) => void
  onFolderDraft: (value: string) => void
  onLabelDraft: (value: string) => void
  onSave: () => void
  onClear: () => void
  onSaveFolder: () => void
  onClearFolder: () => void
  onAddElevenKey: () => void
  onSelectElevenKey: (id: string) => void
  onDeleteElevenKey: (id: string) => void
  onTest: () => void
  pendingSecret: boolean
  pendingClear: boolean
  pendingFolder: boolean
  pendingTest: boolean
  pendingSelectId: string | null
  pendingDeleteId: string | null
}) {
  const comingSoon = item.comingSoon
  const isYandex = item.id === 'yandex'
  const isEleven = item.id === 'elevenlabs'
  const keyBusy = pendingSecret || pendingClear
  const elevenKeys = item.keys ?? []
  const canTest =
    !comingSoon &&
    (item.id === 'elevenlabs'
      ? true
      : item.id === 'yandex'
        ? item.hasKey && Boolean(item.hasFolderId)
        : item.hasKey)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{item.label}</CardTitle>
          {comingSoon ? <Badge variant="secondary">скоро</Badge> : null}
          {!comingSoon && item.hasKey ? (
            <Badge variant="outline">{sourceLabel(item.source)}</Badge>
          ) : null}
        </div>
        <CardDescription>
          {comingSoon
            ? 'Подключим позже — поле пока недоступно.'
            : isYandex
              ? 'Один ключ сервиса: SpeechKit для TTS и тот же ключ для YandexGPT.'
              : isEleven
                ? 'Можно хранить несколько ключей и выбирать активный. Новый ключ сразу становится активным — генерация и баланс идут через него.'
                : item.keyHint
                  ? `Текущий ключ: ${item.keyHint}`
                  : item.hasKey
                    ? 'Ключ задан на сервере (.env), можно переопределить здесь.'
                    : 'Вставьте API key сервиса.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEleven ? (
          <div className="space-y-4">
            {elevenKeys.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Сохранённые ключи</p>
                <ul className="divide-border divide-y rounded-md border">
                  {elevenKeys.map((key) => {
                    const selecting = pendingSelectId === key.id
                    const deleting = pendingDeleteId === key.id
                    return (
                      <li
                        key={key.id}
                        className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                      >
                        <button
                          type="button"
                          className="hover:bg-muted/60 flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm"
                          disabled={comingSoon || selecting || deleting || key.isActive}
                          onClick={() => onSelectElevenKey(key.id)}
                        >
                          <span
                            className={`inline-block size-2 shrink-0 rounded-full ${
                              key.isActive ? 'bg-foreground' : 'bg-muted-foreground/40'
                            }`}
                            aria-hidden
                          />
                          <span className="min-w-0 truncate font-medium">
                            {key.label || key.keyHint || 'Ключ'}
                          </span>
                          {key.isActive ? (
                            <Badge variant="secondary" className="shrink-0">
                              активный
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground shrink-0 text-xs">
                              {selecting ? 'Выбираю…' : 'Выбрать'}
                            </span>
                          )}
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={comingSoon || selecting || deleting}
                          onClick={() => onDeleteElevenKey(key.id)}
                        >
                          {deleting ? 'Удаляю…' : 'Удалить'}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Пока нет ключей в админке
                {item.source === 'env' ? ' — используется запасной ключ с прокси/.env.' : '.'}
              </p>
            )}

            <Field>
              <FieldLabel htmlFor={`api-key-${item.id}`}>Добавить ключ</FieldLabel>
              <FieldContent className="space-y-2">
                <Input
                  id={`api-key-${item.id}`}
                  type="password"
                  autoComplete="off"
                  placeholder="sk_…"
                  value={draft}
                  disabled={comingSoon || keyBusy}
                  onChange={(event) => onDraft(event.target.value)}
                />
                <Input
                  id={`api-label-${item.id}`}
                  type="text"
                  autoComplete="off"
                  placeholder="Подпись (необязательно)"
                  value={labelDraft}
                  disabled={comingSoon || keyBusy}
                  onChange={(event) => onLabelDraft(event.target.value)}
                />
                <FieldDescription>
                  После сохранения ключ станет активным. Полный ключ в интерфейс не возвращается.
                </FieldDescription>
              </FieldContent>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={comingSoon || keyBusy || !draft.trim()}
                onClick={onAddElevenKey}
              >
                {pendingSecret ? 'Добавляю…' : 'Добавить и выбрать'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={comingSoon || pendingTest || !canTest}
                onClick={onTest}
              >
                {pendingTest ? 'Проверяю…' : 'Проверить активный'}
              </Button>
            </div>
          </div>
        ) : isYandex ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">SpeechKit · TTS</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                API key для синтеза речи (и для GPT ниже).
                {item.keyHint ? ` Сейчас: ${item.keyHint}` : ''}
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor={`api-key-${item.id}`}>API key</FieldLabel>
              <FieldContent>
                <Input
                  id={`api-key-${item.id}`}
                  type="password"
                  autoComplete="off"
                  placeholder={item.hasKey ? '••••••••••••' : 'AQVN…'}
                  value={draft}
                  disabled={comingSoon || keyBusy}
                  onChange={(event) => onDraft(event.target.value)}
                />
                <FieldDescription>Полный ключ в интерфейс не возвращается.</FieldDescription>
              </FieldContent>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={comingSoon || keyBusy || !draft.trim()}
                onClick={onSave}
              >
                {pendingSecret ? 'Сохраняю…' : 'Сохранить ключ'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={comingSoon || keyBusy || item.source !== 'database'}
                onClick={onClear}
              >
                {pendingClear ? 'Сбрасываю…' : 'Сбросить ключ админки'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={comingSoon || pendingTest || !canTest}
                onClick={onTest}
              >
                {pendingTest ? 'Проверяю…' : 'Проверить связь'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor={`api-key-${item.id}`}>API key</FieldLabel>
              <FieldContent>
                <Input
                  id={`api-key-${item.id}`}
                  type="password"
                  autoComplete="off"
                  placeholder={item.hasKey ? '••••••••••••' : 'sk-…'}
                  value={draft}
                  disabled={comingSoon || keyBusy}
                  onChange={(event) => onDraft(event.target.value)}
                />
                <FieldDescription>Полный ключ в интерфейс не возвращается.</FieldDescription>
              </FieldContent>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={comingSoon || keyBusy || !draft.trim()}
                onClick={onSave}
              >
                {pendingSecret ? 'Сохраняю…' : 'Сохранить ключ'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={comingSoon || keyBusy || item.source !== 'database'}
                onClick={onClear}
              >
                {pendingClear ? 'Сбрасываю…' : 'Сбросить ключ админки'}
              </Button>
            </div>
          </>
        )}

        {isYandex ? (
          <>
            <Separator />
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">YandexGPT · экстракт и {'{hello}'}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Folder ID каталога в Yandex Cloud — отдельно от TTS.
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="yandex-folder-id">Folder ID</FieldLabel>
                <FieldContent>
                  <Input
                    id="yandex-folder-id"
                    type="text"
                    autoComplete="off"
                    placeholder={item.hasFolderId ? '••••••••' : 'b1g…'}
                    value={folderDraft}
                    disabled={comingSoon || pendingFolder}
                    onChange={(event) => onFolderDraft(event.target.value)}
                  />
                  <FieldDescription>
                    {item.folderIdHint
                      ? `Сейчас: ${item.folderIdHint} (${sourceLabel(item.folderIdSource)})`
                      : 'Нужен для YandexGPT.'}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={comingSoon || pendingFolder || !folderDraft.trim()}
                  onClick={onSaveFolder}
                >
                  {pendingFolder ? 'Сохраняю…' : 'Сохранить folder id'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={comingSoon || pendingFolder || item.folderIdSource !== 'database'}
                  onClick={onClearFolder}
                >
                  Сбросить folder id админки
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function AdminApiPage() {
  const { user } = useOutletContext<CabinetOutlet>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [assemblyProvider, setAssemblyProvider] = useState('yandex')
  const [assemblyProviders, setAssemblyProviders] = useState<AdminAssemblyProvider[]>([])
  const [extractModel, setExtractModel] = useState('assembly')
  const [extractModels, setExtractModels] = useState<AdminExtractModel[]>([])
  const [localLlmError, setLocalLlmError] = useState<string | null>(null)
  const [localLlmConfigured, setLocalLlmConfigured] = useState(false)
  const [integrations, setIntegrations] = useState<AdminIntegrationProvider[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [elevenLabelDraft, setElevenLabelDraft] = useState('')
  const [folderDraft, setFolderDraft] = useState('')

  const applyOverview = (data: Awaited<ReturnType<typeof fetchAdminIntegrations>>) => {
    setAssemblyProvider(data.assemblyProvider || 'yandex')
    setAssemblyProviders(data.assemblyProviders || [])
    setExtractModel(data.extractModel || 'assembly')
    setExtractModels(data.extractModels || [])
    setLocalLlmError(data.localLlmError || null)
    setLocalLlmConfigured(Boolean(data.localLlmConfigured))
    setIntegrations(data.integrations)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchAdminIntegrations()
      .then((data) => {
        if (cancelled) return
        applyOverview(data)
        setDrafts({})
        setElevenLabelDraft('')
        setFolderDraft('')
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!user.isAdmin) {
    return <Navigate to="/app" replace />
  }

  const isPending = (action: string) => pendingAction === action

  const runPending = async (action: string, work: () => Promise<void>) => {
    setPendingAction(action)
    try {
      await work()
    } finally {
      setPendingAction((prev) => (prev === action ? null : prev))
    }
  }

  const saveAssemblyProvider = async (next: string) => {
    const prev = assemblyProvider
    setAssemblyProvider(next)
    await runPending('assembly', async () => {
      try {
        const data = await saveAdminIntegrations({ assemblyProvider: next })
        applyOverview(data)
        toast.success('Провайдер экстракта сохранён')
      } catch (err) {
        setAssemblyProvider(prev)
        toast.error(err instanceof Error ? err.message : 'Не удалось сохранить')
      }
    })
  }

  const saveExtractModel = async (next: string) => {
    const prev = extractModel
    setExtractModel(next)
    await runPending('extract', async () => {
      try {
        const data = await saveAdminIntegrations({ extractModel: next })
        applyOverview(data)
        toast.success('Модель экстракта сохранена')
      } catch (err) {
        setExtractModel(prev)
        toast.error(err instanceof Error ? err.message : 'Не удалось сохранить модель')
      }
    })
  }

  const saveSecret = async (id: string) => {
    const value = String(drafts[id] ?? '').trim()
    if (!value) return
    await runPending(`secret:${id}`, async () => {
      try {
        const data = await saveAdminIntegrations({ secrets: { [id]: value } })
        applyOverview(data)
        setDrafts((prev) => ({ ...prev, [id]: '' }))
        toast.success('Ключ сохранён')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось сохранить ключ')
      }
    })
  }

  const addElevenKey = async () => {
    const value = String(drafts.elevenlabs ?? '').trim()
    if (!value) return
    await runPending('secret:elevenlabs', async () => {
      try {
        const data = await addAdminElevenlabsKey({
          apiKey: value,
          label: elevenLabelDraft.trim(),
          activate: true,
        })
        applyOverview(data)
        setDrafts((prev) => ({ ...prev, elevenlabs: '' }))
        setElevenLabelDraft('')
        toast.success('Ключ добавлен и выбран')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось добавить ключ')
      }
    })
  }

  const selectElevenKey = async (id: string) => {
    await runPending(`select:${id}`, async () => {
      try {
        const data = await selectAdminElevenlabsKey(id)
        applyOverview(data)
        toast.success('Активный ключ обновлён')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось выбрать ключ')
      }
    })
  }

  const deleteElevenKey = async (id: string) => {
    if (!window.confirm('Удалить этот ключ ElevenLabs?')) return
    await runPending(`delete:${id}`, async () => {
      try {
        const data = await deleteAdminElevenlabsKey(id)
        applyOverview(data)
        toast.success('Ключ удалён')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось удалить ключ')
      }
    })
  }

  const clearSecret = async (id: string) => {
    if (!window.confirm('Сбросить ключ из админки? Останется только значение из .env, если оно задано.')) {
      return
    }
    await runPending(`clear:${id}`, async () => {
      try {
        const data = await saveAdminIntegrations({ secrets: { [id]: '' } })
        applyOverview(data)
        setDrafts((prev) => ({ ...prev, [id]: '' }))
        toast.success('Ключ админки сброшен')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось сбросить ключ')
      }
    })
  }

  const saveFolderId = async () => {
    const value = folderDraft.trim()
    if (!value) return
    await runPending('folder', async () => {
      try {
        const data = await saveAdminIntegrations({ configs: { yandexFolderId: value } })
        applyOverview(data)
        setFolderDraft('')
        toast.success('Folder id сохранён')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось сохранить folder id')
      }
    })
  }

  const clearFolderId = async () => {
    if (
      !window.confirm(
        'Сбросить folder id из админки? Останется значение из .env, если оно задано.',
      )
    ) {
      return
    }
    await runPending('folder', async () => {
      try {
        const data = await saveAdminIntegrations({ configs: { yandexFolderId: '' } })
        applyOverview(data)
        setFolderDraft('')
        toast.success('Folder id админки сброшен')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось сбросить folder id')
      }
    })
  }

  const refreshModels = async () => {
    await runPending('models', async () => {
      try {
        const data = await fetchAdminIntegrations()
        applyOverview(data)
        toast.success(
          data.extractModels && data.extractModels.length > 0
            ? `Моделей: ${data.extractModels.length}`
            : 'Список моделей обновлён',
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось обновить список')
      }
    })
  }

  const testProvider = async (provider: 'yandex' | 'elevenlabs' | 'local') => {
    await runPending(`test:${provider}`, async () => {
      try {
        const data = await testAdminIntegration(provider)
        toast.success(data.message || 'Связь есть')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Проверка не удалась')
      }
    })
  }

  const localModelItems =
    extractModels.some((item) => item.id === extractModel) || !extractModel
      ? extractModels
      : [{ id: extractModel, label: extractModel }, ...extractModels]

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="font-sans text-xl font-semibold tracking-tight">API</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ключи для облачной сводки и TTS. Транскрибация — локальный GigaAM. Экстракт параметров
          можно переключить на Qwen.
        </p>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {loading ? <p className="text-muted-foreground text-sm">Загрузка…</p> : null}

      {!loading ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Экстракт данных</CardTitle>
              <CardDescription>
                Кто достаёт JSON сводки из транскрипта. Фраза {'{hello}'} идёт через YandexGPT (нужны
                ключ и folder id), даже если экстракт на Qwen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldSet>
                <FieldLegend className="sr-only">Провайдер экстракта</FieldLegend>
                <RadioGroup
                  value={assemblyProvider}
                  disabled={isPending('assembly')}
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
                        disabled={!item.available || isPending('assembly')}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={`assembly-${item.id}`} className="font-normal">
                          {item.label}
                          {!item.available ? (
                            <Badge variant="secondary" className="ml-2">
                              локальный LLM не подключён
                            </Badge>
                          ) : null}
                        </FieldLabel>
                      </FieldContent>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>

              {assemblyProvider === 'local' ? (
                <Field>
                  <FieldLabel>Модель Qwen</FieldLabel>
                  <FieldContent>
                    {localModelItems.length > 0 ? (
                      <Select
                        items={localModelItems.map((item) => ({
                          value: item.id,
                          label: item.label,
                        }))}
                        value={extractModel}
                        disabled={isPending('extract')}
                        onValueChange={(value) => {
                          const next = String(value ?? '').trim()
                          if (!next || next === extractModel) return
                          void saveExtractModel(next)
                        }}
                      >
                        <SelectTrigger className="w-full min-w-0" disabled={isPending('extract')}>
                          <SelectValue placeholder="Выберите модель" />
                        </SelectTrigger>
                        <SelectContent align="start" alignItemWithTrigger={false}>
                          <SelectGroup>
                            {localModelItems.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        {localLlmError || 'Список моделей пуст.'}
                      </p>
                    )}
                    <FieldDescription>
                      После ollama pull — обновите список.
                    </FieldDescription>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending('models') || !localLlmConfigured}
                        onClick={() => void refreshModels()}
                      >
                        {isPending('models') ? 'Обновляю…' : 'Обновить список'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={isPending('test:local') || !localLlmConfigured}
                        onClick={() => void testProvider('local')}
                      >
                        {isPending('test:local') ? 'Проверяю…' : 'Проверить связь'}
                      </Button>
                    </div>
                  </FieldContent>
                </Field>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {integrations.map((item) => (
              <IntegrationCard
                key={item.id}
                item={item}
                draft={drafts[item.id] ?? ''}
                folderDraft={folderDraft}
                labelDraft={item.id === 'elevenlabs' ? elevenLabelDraft : ''}
                pendingSecret={isPending(`secret:${item.id}`)}
                pendingClear={isPending(`clear:${item.id}`)}
                pendingFolder={isPending('folder')}
                pendingTest={isPending(`test:${item.id}`)}
                pendingSelectId={
                  pendingAction?.startsWith('select:') ? pendingAction.slice('select:'.length) : null
                }
                pendingDeleteId={
                  pendingAction?.startsWith('delete:') ? pendingAction.slice('delete:'.length) : null
                }
                onDraft={(value) => setDrafts((prev) => ({ ...prev, [item.id]: value }))}
                onFolderDraft={setFolderDraft}
                onLabelDraft={setElevenLabelDraft}
                onSave={() => void saveSecret(item.id)}
                onClear={() => void clearSecret(item.id)}
                onSaveFolder={() => void saveFolderId()}
                onClearFolder={() => void clearFolderId()}
                onAddElevenKey={() => void addElevenKey()}
                onSelectElevenKey={(id) => void selectElevenKey(id)}
                onDeleteElevenKey={(id) => void deleteElevenKey(id)}
                onTest={() => {
                  if (item.id === 'yandex' || item.id === 'elevenlabs') {
                    void testProvider(item.id)
                  }
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
