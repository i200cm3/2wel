import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { ApiError, fetchProject, fetchProjects, type Project } from '@/lib/api'
import { fetchSessionUser, type SessionUser } from '@/lib/auth'

const TITLES: Record<string, string> = {
  '': 'Аналитика',
  templates: 'Шаблоны',
  links: 'Ссылки',
  integrations: 'Интеграции',
  edit: 'Конструктор',
  'edit-v2': 'Конструктор V2',
  voice: 'Голос',
  plan: 'Тариф',
  team: 'Команда',
  account: 'Аккаунт',
  users: 'Пользователи',
  'tts-usage': 'Расход TTS',
  api: 'API',
}

export type CabinetOutlet = {
  user: SessionUser
  projects: Project[]
  project: Project | null
  reloadProjects: () => Promise<void>
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void fetchSessionUser().then((next) => {
      if (!cancelled) setUser(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (user === undefined) {
    return <div className="text-muted-foreground flex min-h-svh items-center justify-center">Загрузка…</div>
  }
  if (!user) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return children
}

export function CabinetLayout() {
  const { code } = useParams()
  const location = useLocation()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [guestProject, setGuestProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('cabinet-open')
    return () => document.documentElement.classList.remove('cabinet-open')
  }, [])

  const load = useCallback(async () => {
    const [session, list] = await Promise.all([fetchSessionUser(), fetchProjects()])
    setUser(session)
    setProjects(list.projects)
    setError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await load()
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          setUnauthorized(true)
          return
        }
        setError(err instanceof Error ? err.message : 'Не удалось загрузить кабинет')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const ownedProject = useMemo(() => {
    if (code) return projects?.find((p) => p.code === code) ?? null
    if (projects?.length === 1) return projects[0] ?? null
    return null
  }, [projects, code])

  useEffect(() => {
    if (!code || ownedProject) {
      setGuestProject(null)
      return
    }
    let cancelled = false
    void fetchProject(code)
      .then((data) => {
        if (!cancelled) setGuestProject(data.project)
      })
      .catch(() => {
        if (!cancelled) setGuestProject(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, ownedProject])

  const project = ownedProject ?? guestProject

  const segment = location.pathname.split('/').filter(Boolean).at(-1) ?? ''
  const isUsersSection = location.pathname.startsWith('/app/users')
  const isTtsUsageSection = location.pathname.startsWith('/app/tts-usage')
  const isApiSection = location.pathname === '/app/api' || location.pathname.startsWith('/app/api/')
  const isEditor = segment === 'edit' || segment === 'edit-v2'
  const [sidebarOpen, setSidebarOpen] = useState(!isEditor)
  const sidebarBeforeEditor = useRef(true)

  useEffect(() => {
    if (isEditor) {
      setSidebarOpen((open) => {
        sidebarBeforeEditor.current = open
        return false
      })
      return
    }
    setSidebarOpen(sidebarBeforeEditor.current)
  }, [isEditor])

  const title = !code
    ? segment === 'account'
      ? 'Аккаунт'
      : isUsersSection
        ? 'Пользователи'
        : isTtsUsageSection
          ? 'Расход TTS'
          : isApiSection
            ? 'API'
            : 'Объект'
    : (TITLES[segment] ?? (segment === code ? 'Аналитика' : project?.name ?? 'Кабинет'))

  if (unauthorized) {
    return <Navigate to="/login?next=/app" replace />
  }

  if (error) {
    return (
      <div className="text-destructive flex min-h-svh items-center justify-center px-6 text-center">
        {error}
      </div>
    )
  }

  if (!user || !projects) {
    return <div className="text-muted-foreground flex min-h-svh items-center justify-center">Загрузка…</div>
  }

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="h-svh min-h-0 overflow-hidden"
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} project={project} />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <SiteHeader title={project ? `${project.name} · ${title}` : title} />
        <div
          className={
            isEditor
              ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
              : 'flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto'
          }
        >
          <Outlet context={{ user, projects, project, reloadProjects: load } satisfies CabinetOutlet} />
        </div>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
