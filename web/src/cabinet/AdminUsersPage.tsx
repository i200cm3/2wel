import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  adminSetProjectPlan,
  deleteAdminUser,
  fetchAdminUser,
  searchAdminUsers,
  setAdminUserBlocked,
  type AdminUser,
  type AdminUserWorkspace,
} from '@/lib/api'
import { editorPathForPlan, PLAN_TIERS, planTier } from '@/lib/plans'
import { EllipsisVerticalIcon, SearchIcon } from 'lucide-react'

function formatDt(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminUsersPage() {
  const { user } = useOutletContext<CabinetOutlet>()
  const { userId } = useParams()

  if (!user.isAdmin) {
    return <Navigate to="/app" replace />
  }

  if (userId) {
    return <AdminUserDetail userId={userId} />
  }

  return <AdminUsersSearch currentUserId={user.id} />
}

function AdminUsersSearch({ currentUserId }: { currentUserId: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(id)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setPending(true)
    void searchAdminUsers(debounced)
      .then((data) => {
        if (cancelled) return
        setUsers(data.users)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка')
      })
      .finally(() => {
        if (!cancelled) setPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  const setBlocked = async (item: AdminUser, isBlocked: boolean) => {
    setBusyId(item.id)
    try {
      const data = await setAdminUserBlocked(item.id, isBlocked)
      setUsers((prev) => prev?.map((u) => (u.id === item.id ? { ...u, ...data.user } : u)) ?? null)
      toast.success(isBlocked ? 'Пользователь заблокирован' : 'Пользователь разблокирован')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось изменить статус')
    } finally {
      setBusyId(null)
    }
  }

  const removeUser = async (item: AdminUser) => {
    const label = item.name || item.login
    if (
      !confirm(
        `Удалить пользователя «${label}» и все его проекты? Это нельзя отменить.`,
      )
    ) {
      return
    }
    setBusyId(item.id)
    try {
      await deleteAdminUser(item.id)
      setUsers((prev) => prev?.filter((u) => u.id !== item.id) ?? null)
      toast.success('Пользователь удалён')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Пользователи</h1>
        <p className="text-muted-foreground text-sm">
          Поиск по имени, почте или логину. Клик по строке открывает аккаунт.
        </p>
      </div>

      <div className="relative max-w-md">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск: email, имя, логин…"
          className="pl-8"
          autoFocus
        />
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {users == null ? (
        <p className="text-muted-foreground text-sm">Загрузка…</p>
      ) : users.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {debounced ? 'Никого не нашли.' : 'Пока нет пользователей.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table className="table-fixed">
            <colgroup>
              <col style={{ width: '23%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead>Почта</TableHead>
                <TableHead>Шаблоны</TableHead>
                <TableHead>Создан</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((item) => {
                const canManage = !item.isAdmin && item.id !== currentUserId
                return (
                  <TableRow
                    key={item.id}
                    className={`cursor-pointer ${item.isBlocked ? 'opacity-70' : ''}`}
                    onClick={() => navigate(`/app/users/${item.id}`)}
                  >
                    <TableCell className="overflow-hidden">
                      <span className="font-medium">{item.name || item.login}</span>
                      {item.isAdmin ? (
                        <Badge variant="secondary" className="ml-2">
                          админ
                        </Badge>
                      ) : null}
                      {item.isBlocked ? (
                        <Badge variant="destructive" className="ml-2">
                          заблокирован
                        </Badge>
                      ) : null}
                      <div className="text-muted-foreground truncate text-xs">{item.login}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground overflow-hidden text-sm text-ellipsis">
                      {item.email || '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">{item.templateCount}</TableCell>
                    <TableCell className="text-muted-foreground overflow-hidden text-sm text-ellipsis">
                      {formatDt(item.createdAt)}
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={busyId === item.id}
                            />
                          }
                        >
                          <EllipsisVerticalIcon aria-hidden />
                          <span className="sr-only">Действия для «{item.name || item.login}»</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem onClick={() => navigate(`/app/users/${item.id}`)}>
                            Открыть аккаунт
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {item.isBlocked ? (
                            <DropdownMenuItem
                              disabled={!canManage}
                              onClick={() => void setBlocked(item, false)}
                            >
                              Разблокировать
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={!canManage}
                              onClick={() => void setBlocked(item, true)}
                            >
                              Заблокировать
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!canManage}
                            onClick={() => void removeUser(item)}
                          >
                            Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {pending && users ? (
        <p className="text-muted-foreground text-xs">Обновление…</p>
      ) : null}
    </div>
  )
}

function AdminUserDetail({ userId }: { userId: string }) {
  const [workspace, setWorkspace] = useState<AdminUserWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planBusy, setPlanBusy] = useState<string | null>(null)

  const reload = () =>
    fetchAdminUser(userId).then((data) => {
      setWorkspace(data)
      setError(null)
    })

  useEffect(() => {
    let cancelled = false
    void fetchAdminUser(userId)
      .then((data) => {
        if (cancelled) return
        setWorkspace(data)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка')
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const setPlan = async (projectCode: string, plan: string) => {
    setPlanBusy(projectCode)
    try {
      await adminSetProjectPlan(projectCode, plan)
      await reload()
      toast.success(`Тариф «${planTier(plan).name}» включён`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сменить тариф')
    } finally {
      setPlanBusy(null)
    }
  }

  const title = useMemo(() => {
    if (!workspace) return 'Пользователь'
    return workspace.user.name || workspace.user.login
  }, [workspace])

  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 md:p-6">
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/app/users" />}>
          К списку
        </Button>
      </div>
    )
  }

  if (!workspace) {
    return <p className="text-muted-foreground p-6">Загрузка…</p>
  }

  const { user, projects } = workspace

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{title}</h1>
            {user.isAdmin ? <Badge variant="secondary">админ</Badge> : null}
          </div>
          <p className="text-muted-foreground text-sm">
            {user.email || user.login}
            {user.email && user.login !== user.email ? ` · ${user.login}` : ''}
          </p>
          <p className="text-muted-foreground text-xs">Создан {formatDt(user.createdAt)}</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/app/users" />}>
          К списку
        </Button>
      </div>

      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">У пользователя пока нет проектов.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {projects.map((project) => {
            const currentPlan = planTier(project.plan?.id)
            return (
              <Card key={project.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        <Link
                          to={`/app/projects/${project.code}`}
                          className="hover:underline underline-offset-4"
                        >
                          {project.name}
                        </Link>
                      </CardTitle>
                      <CardDescription>
                        <code className="text-xs">{project.code}</code>
                        {' · '}
                        {project.stats.templates} шабл. · {project.stats.links} ссылок ·{' '}
                        {project.stats.opens} открытий
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={currentPlan.id === 'pro' ? 'default' : 'secondary'}>
                        {currentPlan.name} · {currentPlan.constructor === 'v2' ? 'V2' : 'V1'}
                      </Badge>
                      {PLAN_TIERS.map((tier) => (
                        <Button
                          key={tier.id}
                          variant={tier.id === currentPlan.id ? 'default' : 'outline'}
                          size="sm"
                          disabled={planBusy === project.code || tier.id === currentPlan.id}
                          onClick={() => void setPlan(project.code, tier.id)}
                        >
                          {tier.id === currentPlan.id ? `Тариф «${tier.name}»` : `Включить «${tier.name}»`}
                        </Button>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link to={`/app/projects/${project.code}`} />}
                      >
                        Аналитика
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link to={`/app/projects/${project.code}/templates`} />}
                      >
                        Шаблоны
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {project.templates.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Нет шаблонов</p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Шаблон</TableHead>
                            <TableHead>Статус</TableHead>
                            <TableHead className="text-right">Действие</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {project.templates.map((tpl) => (
                            <TableRow key={tpl.id}>
                              <TableCell>
                                <div className="font-medium">{tpl.name}</div>
                                <code className="text-muted-foreground text-xs">{tpl.code}</code>
                                {tpl.isDefault ? (
                                  <Badge variant="secondary" className="ml-2">
                                    по умолчанию
                                  </Badge>
                                ) : null}
                                {tpl.hasDraft ? (
                                  <Badge variant="outline" className="ml-2">
                                    черновик
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {tpl.status === 'published' ? 'опубликован' : 'черновик'}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  nativeButton={false}
                                  render={
                                    <Link
                                      to={editorPathForPlan(project.plan?.id, project.code, tpl.code)}
                                    />
                                  }
                                >
                                  {currentPlan.constructor === 'v2' ? 'V2' : 'V1'}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
