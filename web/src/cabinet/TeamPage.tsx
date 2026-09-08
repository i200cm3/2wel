import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
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
  canManageProject,
  fetchProjectTeam,
  inviteProjectMember,
  leaveProject,
  removeProjectMember,
  revokeProjectInvite,
  type ProjectTeamInvite,
  type ProjectTeamMember,
} from '@/lib/api'

function formatDt(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'владелец',
  member: 'сотрудник',
}

export function TeamPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user, project, reloadProjects } = useOutletContext<CabinetOutlet>()
  const projectCode = code || project?.code || ''
  const canManage = canManageProject(project)
  const [members, setMembers] = useState<ProjectTeamMember[]>([])
  const [invites, setInvites] = useState<ProjectTeamInvite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)

  const reload = () =>
    fetchProjectTeam(projectCode).then((data) => {
      setMembers(data.members)
      setInvites(data.invites)
      setError(null)
    })

  useEffect(() => {
    if (!projectCode) return
    let cancelled = false
    void reload().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить команду')
    })
    return () => {
      cancelled = true
    }
  }, [projectCode])

  if (error) return <p className="text-destructive p-6">{error}</p>
  if (!projectCode) return <p className="text-muted-foreground p-6">Нет объекта</p>

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Команда</CardTitle>
          <CardDescription>
            Сотрудник входит в этот объект: шаблоны, ссылки, голос. Без прав администратора
            системы и без управления тарифом, интеграциями и составом команды.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {revealed ? (
            <div className="bg-muted space-y-2 rounded-lg p-3">
              <p className="text-sm font-medium">Ссылка показывается один раз</p>
              <code className="block break-all text-xs">{revealed}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(revealed).then(() => toast.success('Скопировано'))
                }}
              >
                Копировать
              </Button>
            </div>
          ) : null}
          {canManage ? (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault()
                const nextEmail = email.trim()
                if (!nextEmail) return
                setPending(true)
                void inviteProjectMember(projectCode, nextEmail)
                  .then((data) => {
                    setEmail('')
                    if (data.added) {
                      setRevealed(null)
                      toast.success('Сотрудник добавлен в объект')
                    } else {
                      const url = data.invite?.url || ''
                      setRevealed(url || null)
                      if (url) void navigator.clipboard.writeText(url).catch(() => undefined)
                      toast.success(
                        data.mailed
                          ? 'Приглашение создано и отправлено на почту'
                          : 'Приглашение создано — передайте ссылку',
                      )
                    }
                    return reload()
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : 'Не удалось пригласить'))
                  .finally(() => setPending(false))
              }}
            >
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Почта сотрудника</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="content@plaza.spa"
                  required
                  disabled={pending}
                />
              </label>
              <Button type="submit" disabled={pending || !email.trim()}>
                {pending ? 'Добавляю…' : 'Пригласить'}
              </Button>
            </form>
          ) : (
            <p className="text-muted-foreground text-sm">
              Приглашать может только владелец объекта.
            </p>
          )}
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>С</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((item) => {
                  const isSelf = item.id === user.id
                  const canRemove = canManage && item.role !== 'owner'
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{item.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {item.email || item.login}
                            {isSelf ? ' · вы' : ''}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{ROLE_LABEL[item.role] || item.role}</TableCell>
                      <TableCell>{formatDt(item.joinedAt)}</TableCell>
                      <TableCell className="text-right">
                        {canRemove ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={busyId === item.id}
                            onClick={() => {
                              if (!confirm(`Удалить «${item.name || item.email}» из команды объекта?`)) {
                                return
                              }
                              setBusyId(item.id)
                              void removeProjectMember(projectCode, item.id)
                                .then(() => {
                                  toast.success('Сотрудник удалён из команды')
                                  return reload()
                                })
                                .catch((err) =>
                                  toast.error(err instanceof Error ? err.message : 'Не удалось удалить'),
                                )
                                .finally(() => setBusyId(null))
                            }}
                          >
                            Удалить
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {canManage && invites.length > 0 ? (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ожидают вход</TableHead>
                    <TableHead>Создано</TableHead>
                    <TableHead>Истекает</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.email || '—'}</TableCell>
                      <TableCell>{formatDt(item.createdAt)}</TableCell>
                      <TableCell>{formatDt(item.expiresAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busyId === `invite:${item.id}`}
                          onClick={() => {
                            if (!confirm(`Удалить приглашение для ${item.email || 'сотрудника'}?`)) {
                              return
                            }
                            setBusyId(`invite:${item.id}`)
                            void revokeProjectInvite(projectCode, item.id)
                              .then(() => {
                                toast.success('Приглашение удалено')
                                return reload()
                              })
                              .catch((err) =>
                                toast.error(err instanceof Error ? err.message : 'Не удалось удалить'),
                              )
                              .finally(() => setBusyId(null))
                          }}
                        >
                          Удалить
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          {!canManage ? (
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busyId)}
              onClick={() => {
                if (!confirm('Покинуть этот объект? Доступ пропадёт, пока владелец снова не пригласит.')) {
                  return
                }
                setBusyId('leave')
                void leaveProject(projectCode)
                  .then(async () => {
                    toast.success('Вы вышли из объекта')
                    await reloadProjects()
                    navigate('/app', { replace: true })
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : 'Не удалось выйти'))
                  .finally(() => setBusyId(null))
              }}
            >
              Покинуть объект
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
