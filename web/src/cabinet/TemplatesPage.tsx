import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  createTemplate,
  deleteTemplate,
  fetchTemplateOrphanMedia,
  fetchTemplates,
  patchTemplate,
  peekTemplates,
  publishTemplate,
  type Template,
} from '@/lib/api'
import { EllipsisVerticalIcon, Loader2Icon, PlusIcon } from 'lucide-react'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

function copyTemplateName(source: Template, templates: Template[]) {
  const used = new Set(templates.map((item) => item.name))
  const base = `${source.name} (копия)`
  if (!used.has(base)) return base
  for (let i = 2; i < 50; i += 1) {
    const next = `${source.name} (копия ${i})`
    if (!used.has(next)) return next
  }
  return base
}

function ruFiles(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'файл'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'файла'
  return 'файлов'
}

export function TemplatesPage() {
  const { code } = useParams()
  const { user } = useOutletContext<CabinetOutlet>()
  const [templates, setTemplates] = useState<Template[] | null>(() =>
    code ? peekTemplates(code) : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [fromCode, setFromCode] = useState('')
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [rename, setRename] = useState<Template | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameCode, setRenameCode] = useState('')

  const reload = (projectCode: string) =>
    fetchTemplates(projectCode).then((data) => setTemplates(data.templates))

  useEffect(() => {
    if (!code) return
    let cancelled = false
    const cached = peekTemplates(code)
    if (cached) setTemplates(cached)
    void fetchTemplates(code)
      .then((data) => {
        if (cancelled) return
        setTemplates(data.templates)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка')
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) return <p className="text-destructive p-6">{error}</p>
  if (!templates) return <p className="text-muted-foreground p-6">Загрузка…</p>

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          if (!code) return
          setPending(true)
          setFormError(null)
          void createTemplate(code, {
            name: name.trim(),
            from: fromCode || undefined,
          })
            .then((data) => {
              setName('')
              toast.success(
                fromCode
                  ? `Скопирован как «${data.template.name}» (${data.template.code})`
                  : `Создан «${data.template.name}» (${data.template.code})`,
              )
              return reload(code)
            })
            .catch((err) => {
              setFormError(err instanceof Error ? err.message : 'Не удалось создать шаблон')
            })
            .finally(() => setPending(false))
        }}
      >
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Название</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Новый шаблон"
            required
            disabled={pending}
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Копировать из</span>
          <NativeSelect
            value={fromCode}
            onChange={(event) => setFromCode(event.target.value)}
            disabled={pending}
            className="h-8 w-full"
          >
            <NativeSelectOption value="">Пустой шаблон</NativeSelectOption>
            {templates.map((tpl) => (
              <NativeSelectOption key={tpl.id} value={tpl.code}>
                {tpl.name} ({tpl.code})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? 'Создание…' : 'Новый шаблон'}
        </Button>
        <HoverCard>
          <HoverCardTrigger
            delay={200}
            closeDelay={100}
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={pending}
                onClick={() => {
                  if (!code) return
                  setPending(true)
                  setFormError(null)
                  void createTemplate(code, { name: 'Пример шаблона: Сосновый берег', starter: true })
                    .then((data) => {
                      toast.success(`Добавлен «${data.template.name}» (${data.template.code})`)
                      return reload(code)
                    })
                    .catch((err) => {
                      setFormError(err instanceof Error ? err.message : 'Не удалось добавить шаблон')
                    })
                    .finally(() => setPending(false))
                }}
              />
            }
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
            <span className="sr-only">Добавить пример шаблона: Сосновый берег</span>
          </HoverCardTrigger>
          <HoverCardContent side="top" className="w-auto max-w-64">
            <p className="font-medium">Пример шаблона: Сосновый берег</p>
            <p className="text-muted-foreground">Добавить тестовый шаблон</p>
          </HoverCardContent>
        </HoverCard>
      </form>
      {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Код</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-40 text-right"> </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Шаблонов нет
                </TableCell>
              </TableRow>
            ) : (
              templates.map((tpl) => (
                <TableRow key={tpl.id}>
                  <TableCell className="font-medium">
                    {tpl.name}
                    {tpl.isDefault ? (
                      <Badge variant="secondary" className="ml-2">
                        по умолчанию
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{tpl.code}</code>
                  </TableCell>
                  <TableCell>
                    {tpl.status === 'published' ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        опубликован
                        {tpl.hasDraft ? (
                          <Badge variant="outline">есть правки</Badge>
                        ) : null}
                      </span>
                    ) : (
                      'черновик'
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {user.isAdmin ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false}
                            render={<Link to={`/app/projects/${code}/templates/${tpl.code}/edit`} />}
                          >
                            V1
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false}
                            render={<Link to={`/app/projects/${code}/templates/${tpl.code}/edit-v2`} />}
                          >
                            V2
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          nativeButton={false}
                          render={<Link to={`/app/projects/${code}/templates/${tpl.code}/edit`} />}
                        >
                          Конструктор шаблона
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" disabled={busyCode === tpl.code} />}
                        >
                          <EllipsisVerticalIcon />
                          <span className="sr-only">Действия</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem
                            onClick={() => {
                              setRename(tpl)
                              setRenameName(tpl.name)
                              setRenameCode(tpl.code)
                            }}
                          >
                            Переименовать
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={Boolean(busyCode) || pending}
                            onClick={() => {
                              if (!code) return
                              setBusyCode(tpl.code)
                              void createTemplate(code, {
                                name: copyTemplateName(tpl, templates),
                                from: tpl.code,
                              })
                                .then((data) => {
                                  toast.success(`Скопирован как «${data.template.name}» (${data.template.code})`)
                                  return reload(code)
                                })
                                .catch((err) => {
                                  toast.error(err instanceof Error ? err.message : 'Не удалось скопировать')
                                })
                                .finally(() => setBusyCode(null))
                            }}
                          >
                            Создать копию
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={Boolean(busyCode) || (tpl.status === 'published' && !tpl.hasDraft)}
                            onClick={() => {
                              if (!code) return
                              setBusyCode(tpl.code)
                              void publishTemplate(code, tpl.code)
                                .then(() => reload(code))
                                .then(() => toast.success(`«${tpl.name}» опубликован`))
                                .catch((err) => {
                                  toast.error(err instanceof Error ? err.message : 'Не удалось опубликовать')
                                })
                                .finally(() => setBusyCode(null))
                            }}
                          >
                            Опубликовать
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={tpl.isDefault}
                            onClick={() => {
                              if (!code) return
                              setBusyCode(tpl.code)
                              void patchTemplate(code, tpl.code, { isDefault: true })
                                .then(() => reload(code))
                                .then(() => toast.success(`«${tpl.name}» — по умолчанию`))
                                .catch((err) => {
                                  toast.error(err instanceof Error ? err.message : 'Не удалось')
                                })
                                .finally(() => setBusyCode(null))
                            }}
                          >
                            Сделать по умолчанию
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                              if (!code) return
                              if (!window.confirm(`Удалить шаблон «${tpl.name}» (${tpl.code})?`)) return
                              setBusyCode(tpl.code)
                              void (async () => {
                                let purgeUnused = false
                                try {
                                  const preview = await fetchTemplateOrphanMedia(code, tpl.code)
                                  if (preview.count > 0) {
                                    purgeUnused = window.confirm(
                                      `Удалить ещё ${preview.count} ${ruFiles(preview.count)} (картинки/видео/озвучка), которые больше не используются ни в одном шаблоне?`,
                                    )
                                  }
                                } catch {
                                  // без превью — удаляем только шаблон
                                }
                                const data = await deleteTemplate(code, tpl.code, { purgeUnused })
                                await reload(code)
                                const purged =
                                  data.purgedMedia && data.purgedMedia > 0
                                    ? `, очищено файлов: ${data.purgedMedia}`
                                    : ''
                                if (data.replaced && data.template) {
                                  toast.success(
                                    `Удалён. Создан «${data.template.name}» (${data.template.code})${purged}`,
                                  )
                                } else {
                                  toast.success(`Шаблон удалён${purged}`)
                                }
                              })()
                                .catch((err) => {
                                  toast.error(err instanceof Error ? err.message : 'Не удалось удалить')
                                })
                                .finally(() => setBusyCode(null))
                            }}
                          >
                            Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Dialog
        open={Boolean(rename)}
        onOpenChange={(open) => {
          if (!open) setRename(null)
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!code || !rename) return
              setBusyCode(rename.code)
              void patchTemplate(code, rename.code, {
                name: renameName.trim(),
                code: renameCode.trim() !== rename.code ? renameCode.trim() : undefined,
              })
                .then(() => reload(code))
                .then(() => {
                  toast.success('Шаблон обновлён')
                  setRename(null)
                })
                .catch((err) => {
                  toast.error(err instanceof Error ? err.message : 'Не удалось сохранить')
                })
                .finally(() => setBusyCode(null))
            }}
          >
            <DialogHeader>
              <DialogTitle>Шаблон</DialogTitle>
              <DialogDescription>Название и код категории для CRM.</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Название</span>
              <Input
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Код</span>
              <Input
                value={renameCode}
                onChange={(event) => setRenameCode(event.target.value)}
                required
                pattern="[a-z0-9][a-z0-9_-]{0,63}"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRename(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={!renameName.trim() || !renameCode.trim()}>
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
