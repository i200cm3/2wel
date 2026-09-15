import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useOutletContext } from 'react-router-dom'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchAdminProjects, type AdminProject } from '@/lib/api'
import { SearchIcon } from 'lucide-react'

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

export function AdminProjectsPage() {
  const { user } = useOutletContext<CabinetOutlet>()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [projects, setProjects] = useState<AdminProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(id)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setPending(true)
    void fetchAdminProjects(debounced)
      .then((data) => {
        if (cancelled) return
        setProjects(data.projects)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить проекты')
        setProjects([])
      })
      .finally(() => {
        if (!cancelled) setPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  if (!user.isAdmin) {
    return <Navigate to="/app" replace />
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-lg font-semibold">Проекты сервиса</h2>
        <p className="text-muted-foreground text-sm">
          Все объекты. Откройте проект, чтобы помочь с шаблонами и ссылками.
        </p>
      </div>

      <div className="relative max-w-md">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по названию, коду, владельцу…"
          className="pl-9"
        />
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {projects === null ? (
        <p className="text-muted-foreground text-sm">Загрузка…</p>
      ) : projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {pending ? 'Загрузка…' : debounced ? 'Ничего не найдено' : 'Проектов пока нет'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Объект</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead className="text-right">Шабл.</TableHead>
                <TableHead className="text-right">Ссылки</TableHead>
                <TableHead className="text-right">Откр.</TableHead>
                <TableHead>Создан</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow
                  key={project.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/app/projects/${project.code}`)}
                >
                  <TableCell className="overflow-hidden">
                    <span className="font-medium">{project.name}</span>
                    <div className="text-muted-foreground truncate text-xs">{project.code}</div>
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <span className="text-sm">{project.owner.name}</span>
                    <div className="text-muted-foreground truncate text-xs">
                      {project.owner.login}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{project.plan.name}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{project.stats.templates}</TableCell>
                  <TableCell className="text-right tabular-nums">{project.stats.links}</TableCell>
                  <TableCell className="text-right tabular-nums">{project.stats.opens}</TableCell>
                  <TableCell className="text-muted-foreground overflow-hidden text-sm text-ellipsis">
                    {formatDt(project.createdAt)}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link to={`/app/projects/${project.code}`} />}
                      >
                        Открыть
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        nativeButton={false}
                        render={<Link to={`/app/projects/${project.code}/templates`} />}
                      >
                        Шаблоны
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        nativeButton={false}
                        render={<Link to={`/app/projects/${project.code}/links`} />}
                      >
                        Ссылки
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
