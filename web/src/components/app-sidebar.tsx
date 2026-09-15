import * as React from "react"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { AuthUser, Project } from "@/lib/api"
import { BrandLogo } from "@/components/BrandLogo"
import {
  Building2Icon,
  ClapperboardIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  LinkIcon,
  MicIcon,
  AudioLinesIcon,
  KeyRoundIcon,
  PhoneIcon,
  PlugIcon,
  ChartColumnIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react"
import { Link, useParams } from "react-router-dom"

export function AppSidebar({
  user,
  project,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: AuthUser
  project: Project | null
}) {
  const { code } = useParams()
  // Меню отеля только когда реально открыт /app/projects/:code — не подставляем «свой» проект на страницах админки.
  const inProject = Boolean(code)
  const base = inProject ? `/app/projects/${code}` : "/app"
  const homeTo = inProject
    ? `/app/projects/${code}`
    : user.isAdmin
      ? "/app/analytics"
      : project?.code
        ? `/app/projects/${project.code}`
        : "/app/account"

  const navWork = inProject
    ? [
        { title: "Аналитика", url: base, icon: <LayoutDashboardIcon /> },
        { title: "Шаблоны", url: `${base}/templates`, icon: <ClapperboardIcon /> },
        { title: "Ссылки", url: `${base}/links`, icon: <LinkIcon /> },
        { title: "Звонки", url: `${base}/calls`, icon: <PhoneIcon /> },
      ]
    : []

  const navSettings = inProject
    ? [
        { title: "Голос", url: `${base}/voice`, icon: <MicIcon /> },
        { title: "Команда", url: `${base}/team`, icon: <UsersRoundIcon /> },
        { title: "Интеграции", url: `${base}/integrations`, icon: <PlugIcon /> },
        { title: "Тариф", url: `${base}/plan`, icon: <GaugeIcon /> },
      ]
    : []

  const adminNav = user.isAdmin
    ? [
        { title: "Аналитика", url: "/app/analytics", icon: <ChartColumnIcon /> },
        { title: "Проекты", url: "/app/projects", icon: <Building2Icon />, exact: true },
        { title: "Пользователи", url: "/app/users", icon: <UsersIcon /> },
        { title: "API", url: "/app/api", icon: <KeyRoundIcon /> },
        { title: "Расход TTS", url: "/app/tts-usage", icon: <AudioLinesIcon /> },
      ]
    : []

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:h-auto! data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link to={homeTo} />}
            >
              <BrandLogo size="sm" className="rounded-sm" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navWork.length ? <NavMain items={navWork} /> : null}
        {navSettings.length ? <NavMain label="Настройки" items={navSettings} /> : null}
        {adminNav.length ? <NavMain label="Админ" items={adminNav} /> : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name: user.name,
            login: user.login,
            email: user.email || user.login,
          }}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
