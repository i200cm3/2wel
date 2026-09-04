import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  connectAmo,
  createApiKey,
  deleteApiKey,
  disconnectAmo,
  fetchAmoConnection,
  fetchApiKeys,
  fetchTemplates,
  revokeApiKey,
  saveAmoStatusMap,
  type AmoConnection,
  type AmoStatusMap,
  type ProjectApiKey,
  type Template,
} from '@/lib/api'
import { maskPkLive } from '@/lib/utils'

function formatDt(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type MapDraft = { key: string; statusId: string; templateCode: string; label: string }

function mapsToDraft(maps: AmoStatusMap[]): MapDraft[] {
  return maps.map((item, index) => ({
    key: `${item.statusId}-${index}`,
    statusId: item.statusId,
    templateCode: item.templateCode,
    label: item.label || '',
  }))
}

export function IntegrationsPage() {
  const { code } = useParams()
  const { project } = useOutletContext<CabinetOutlet>()
  const projectCode = code || project?.code || ''
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<AmoConnection | null>(null)
  const [keys, setKeys] = useState<ProjectApiKey[] | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [mapDraft, setMapDraft] = useState<MapDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [pendingMap, setPendingMap] = useState(false)
  const [pendingKey, setPendingKey] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedAmo, setCopiedAmo] = useState(false)

  const reloadAmo = () => {
    if (!projectCode) return
    void fetchAmoConnection(projectCode)
      .then((next) => {
        setData(next)
        setMapDraft(mapsToDraft(next.statusMaps || []))
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка'))
  }

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    void Promise.all([
      fetchAmoConnection(projectCode),
      fetchApiKeys(projectCode),
      fetchTemplates(projectCode),
    ])
      .then(([amo, keyData, tpl]) => {
        if (cancelled) return
        setData(amo)
        setMapDraft(mapsToDraft(amo.statusMaps || []))
        setKeys(keyData.keys)
        setTemplates(tpl.templates || [])
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка')
      })
    return () => {
      cancelled = true
    }
  }, [projectCode])

  useEffect(() => {
    const amo = params.get('amo')
    if (!amo) return
    if (amo === 'ok') toast.success('AmoCRM подключена')
    else if (amo === 'warn')
      toast.message('AmoCRM подключена, webhook повесьте вручную', {
        description: params.get('reason') || undefined,
      })
    else toast.error(params.get('reason') || 'Не удалось подключить AmoCRM')
    const next = new URLSearchParams(params)
    next.delete('amo')
    next.delete('reason')
    setParams(next, { replace: true })
    reloadAmo()
  }, [params, projectCode, setParams])

  const statusOptions = useMemo(() => {
    const pipelines = data?.pipelines || []
    const out: { id: string; name: string; group: string }[] = []
    for (const pipe of pipelines) {
      for (const st of pipe.statuses) {
        out.push({ id: st.id, name: st.name, group: pipe.name })
      }
    }
    return out
  }, [data?.pipelines])

  const publishedTemplates = useMemo(
    () => templates.filter((item) => item.status === 'published'),
    [templates],
  )

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://2wel.ru'
  const revealedWebhook = revealed ? `${origin}/api/v1/amocrm/webhook/${revealed}` : ''

  if (error) return <p className="text-destructive p-6">{error}</p>
  if (!data || !keys) return <p className="text-muted-foreground p-6">Загрузка…</p>

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-sans">AmoCRM</CardTitle>
          <CardDescription>
            Подключите аккаунт к amoCRM. Ссылка на ролик пишется в поле сделки «Ссылка для
            презентации».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!data.configured ? (
            <p className="text-muted-foreground">AmoCRM на сервере не настроена.</p>
          ) : null}
          {data.connected ? (
            <div className="space-y-3">
              <p>
                <span className="text-green-600">● Подключено</span>{' '}
                <code>{data.baseDomain}</code>
              </p>
              <p className="text-muted-foreground text-xs">с {formatDt(data.connectedAt)}</p>
              {data.webhookUrl ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">Webhook этого объекта</p>
                  <code className="bg-muted block break-all rounded-lg p-3 text-xs">
                    {maskPkLive(data.webhookUrl)}
                  </code>
                  <p className="text-muted-foreground text-xs">
                    На экране только начало ключа, как в таблице. Полный адрес копируется в буфер.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(data.webhookUrl || '').then(() => {
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1500)
                      })
                    }}
                  >
                    {copied ? 'Скопировано' : 'Копировать URL'}
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending || !data.configured}
                  onClick={() => {
                    if (!projectCode) return
                    setPending(true)
                    void connectAmo(projectCode)
                      .then((out) => {
                        window.location.href = out.authUrl
                      })
                      .catch((err) => {
                        toast.error(err instanceof Error ? err.message : 'Не удалось начать OAuth')
                        setPending(false)
                      })
                  }}
                >
                  Переподключить
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    if (!projectCode) return
                    if (!window.confirm('Отключить AmoCRM у этого объекта?')) return
                    setPending(true)
                    void disconnectAmo(projectCode)
                      .then(() => {
                        toast.success('AmoCRM отключена')
                        reloadAmo()
                      })
                      .catch((err) => toast.error(err instanceof Error ? err.message : 'Ошибка'))
                      .finally(() => setPending(false))
                  }}
                >
                  Отключить
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-muted-foreground">Ещё не подключено.</p>
              <Button
                type="button"
                disabled={pending || !data.configured}
                onClick={() => {
                  if (!projectCode) return
                  setPending(true)
                  void connectAmo(projectCode)
                    .then((out) => {
                      window.location.href = out.authUrl
                    })
                    .catch((err) => {
                      toast.error(err instanceof Error ? err.message : 'Не удалось начать OAuth')
                      setPending(false)
                    })
                }}
              >
                {pending ? 'Переход в amo…' : 'Подключить AmoCRM'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {data.connected ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-sans">Шаблоны по статусам</CardTitle>
            <CardDescription>
              Одна и та же ссылка гостя. При смене этапа сделки webhook переключает шаблон.
              Явный category в запросе важнее этой карты.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {publishedTemplates.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Сначала опубликуйте хотя бы один шаблон.
              </p>
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Статус amo</TableHead>
                        <TableHead>Шаблон</TableHead>
                        <TableHead className="w-12"> </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mapDraft.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-muted-foreground">
                            Карта пуста — на любом этапе останется шаблон первой выдачи.
                          </TableCell>
                        </TableRow>
                      ) : (
                        mapDraft.map((row) => (
                          <TableRow key={row.key}>
                            <TableCell className="align-top">
                              {statusOptions.length > 0 ? (
                                <select
                                  className="border-input bg-background h-9 w-full max-w-xs rounded-md border px-2 text-sm"
                                  value={row.statusId}
                                  onChange={(event) => {
                                    const id = event.target.value
                                    const opt = statusOptions.find((item) => item.id === id)
                                    setMapDraft((prev) =>
                                      prev.map((item) =>
                                        item.key === row.key
                                          ? {
                                              ...item,
                                              statusId: id,
                                              label: opt
                                                ? `${opt.group}: ${opt.name}`
                                                : item.label,
                                            }
                                          : item,
                                      ),
                                    )
                                  }}
                                >
                                  <option value="">Выберите статус</option>
                                  {statusOptions.map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                      {opt.group}: {opt.name} ({opt.id})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <Input
                                  value={row.statusId}
                                  inputMode="numeric"
                                  placeholder="status_id"
                                  onChange={(event) => {
                                    const id = event.target.value.trim()
                                    setMapDraft((prev) =>
                                      prev.map((item) =>
                                        item.key === row.key ? { ...item, statusId: id } : item,
                                      ),
                                    )
                                  }}
                                />
                              )}
                              {row.label ? (
                                <p className="text-muted-foreground mt-1 text-xs">{row.label}</p>
                              ) : null}
                            </TableCell>
                            <TableCell className="align-top">
                              <select
                                className="border-input bg-background h-9 w-full max-w-xs rounded-md border px-2 text-sm"
                                value={row.templateCode}
                                onChange={(event) => {
                                  const nextCode = event.target.value
                                  setMapDraft((prev) =>
                                    prev.map((item) =>
                                      item.key === row.key
                                        ? { ...item, templateCode: nextCode }
                                        : item,
                                    ),
                                  )
                                }}
                              >
                                {publishedTemplates.map((tpl) => (
                                  <option key={tpl.code} value={tpl.code}>
                                    {tpl.name} ({tpl.code})
                                  </option>
                                ))}
                              </select>
                            </TableCell>
                            <TableCell className="align-top text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Удалить правило"
                                onClick={() =>
                                  setMapDraft((prev) => prev.filter((item) => item.key !== row.key))
                                }
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const first = publishedTemplates[0]
                      if (!first) return
                      setMapDraft((prev) => [
                        ...prev,
                        {
                          key: `new-${Date.now()}`,
                          statusId: '',
                          templateCode: first.code,
                          label: '',
                        },
                      ])
                    }}
                  >
                    <Plus className="size-4" aria-hidden />
                    Добавить
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pendingMap}
                    onClick={() => {
                      if (!projectCode) return
                      const incomplete = mapDraft.some((item) => !item.statusId)
                      if (incomplete) {
                        toast.error('Укажите статус для каждого правила')
                        return
                      }
                      const maps = mapDraft.map((item) => ({
                        statusId: item.statusId,
                        templateCode: item.templateCode,
                        label: item.label || null,
                      }))
                      setPendingMap(true)
                      void saveAmoStatusMap(projectCode, maps)
                        .then((out) => {
                          setMapDraft(mapsToDraft(out.maps))
                          setData((prev) => (prev ? { ...prev, statusMaps: out.maps } : prev))
                          toast.success('Карта статусов сохранена')
                        })
                        .catch((err) =>
                          toast.error(err instanceof Error ? err.message : 'Не удалось сохранить'),
                        )
                        .finally(() => setPendingMap(false))
                    }}
                  >
                    {pendingMap ? 'Сохранение…' : 'Сохранить'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Ключ проекта</CardTitle>
          <CardDescription>
            CRM вызывает API с ключом, без логина в кабинет. Полный ключ показывается один раз при
            создании — потом только префикс.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {revealed ? (
            <div className="bg-muted space-y-3 rounded-lg p-3">
              <p className="text-sm font-medium">Скопируйте — ключ больше не показать</p>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">Ключ (Bearer)</p>
                <code className="block break-all text-xs">{revealed}</code>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">URL для amo «Отправить webhook»</p>
                <code className="block break-all text-xs">{revealedWebhook}</code>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(revealed).then(() => {
                      setCopiedKey(true)
                      window.setTimeout(() => setCopiedKey(false), 1500)
                    })
                  }}
                >
                  {copiedKey ? 'Ключ скопирован' : 'Копировать ключ'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(revealedWebhook).then(() => {
                      setCopiedAmo(true)
                      window.setTimeout(() => setCopiedAmo(false), 1500)
                    })
                  }}
                >
                  {copiedAmo ? 'URL скопирован' : 'Копировать URL для amo'}
                </Button>
              </div>
            </div>
          ) : null}
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              if (!projectCode) return
              setPendingKey(true)
              setFormError(null)
              void createApiKey(projectCode, name.trim())
                .then((created) => {
                  setName('')
                  setRevealed(created.key.token ?? null)
                  setCopiedKey(false)
                  setCopiedAmo(false)
                  return fetchApiKeys(projectCode)
                })
                .then((next) => setKeys(next.keys))
                .catch((err) => {
                  setFormError(err instanceof Error ? err.message : 'Не удалось создать ключ')
                })
                .finally(() => setPendingKey(false))
            }}
          >
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Название</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CRM"
                disabled={pendingKey}
              />
            </label>
            <Button type="submit" disabled={pendingKey}>
              {pendingKey ? 'Создание…' : 'Создать ключ'}
            </Button>
          </form>
          {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Ключ</TableHead>
                  <TableHead>Создан</TableHead>
                  <TableHead>Использован</TableHead>
                  <TableHead className="w-40 text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Пока нет ключей. Создайте ключ для CRM.
                    </TableCell>
                  </TableRow>
                ) : (
                  keys.map((key) => (
                    <TableRow key={key.id} className={key.revokedAt ? 'opacity-60' : undefined}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell>
                        <code className="text-xs">{key.prefix}…</code>
                        {key.revokedAt ? (
                          <span className="text-muted-foreground ml-2 text-xs">отозван</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{formatDt(key.createdAt)}</TableCell>
                      <TableCell>{formatDt(key.lastUsedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {key.revokedAt ? null : (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={revokingId === key.id || deletingId === key.id}
                              onClick={() => {
                                if (!projectCode) return
                                if (!window.confirm(`Отозвать ключ ${key.prefix}…?`)) return
                                setRevokingId(key.id)
                                void revokeApiKey(projectCode, key.id)
                                  .then(() => fetchApiKeys(projectCode))
                                  .then((next) => setKeys(next.keys))
                                  .catch((err) => {
                                    setFormError(
                                      err instanceof Error ? err.message : 'Не удалось отозвать',
                                    )
                                  })
                                  .finally(() => setRevokingId(null))
                              }}
                            >
                              {revokingId === key.id ? 'Отзыв…' : 'Отозвать'}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Удалить ключ"
                            aria-label={`Удалить ключ ${key.prefix}`}
                            disabled={deletingId === key.id || revokingId === key.id}
                            onClick={() => {
                              if (!projectCode) return
                              if (
                                !window.confirm(`Удалить ключ ${key.prefix}… безвозвратно?`)
                              )
                                return
                              setDeletingId(key.id)
                              void deleteApiKey(projectCode, key.id)
                                .then(() => {
                                  if (revealed?.startsWith(key.prefix)) setRevealed(null)
                                  return fetchApiKeys(projectCode)
                                })
                                .then((next) => setKeys(next.keys))
                                .catch((err) => {
                                  setFormError(
                                    err instanceof Error ? err.message : 'Не удалось удалить',
                                  )
                                })
                                .finally(() => setDeletingId(null))
                            }}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
