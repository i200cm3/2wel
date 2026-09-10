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
  ClapperboardIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  LinkIcon,
  MicIcon,
  AudioLinesIcon,
  KeyRoundIcon,
  PlugIcon,
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
  const projectCode = code || project?.code
  const base = projectCode ? `/app/projects/${projectCode}` : "/app"
  const homeTo = projectCode ? `/app/projects/${projectCode}` : "/app/account"

  const navWork = projectCode
    ? [
        { title: "Аналитика", url: base, icon: <LayoutDashboardIcon /> },
        { title: "Шаблоны", url: `${base}/templates`, icon: <ClapperboardIcon /> },
        { title: "Ссылки", url: `${base}/links`, icon: <LinkIcon /> },
      ]
    : []

  const navSettings = projectCode
    ? [
        { title: "Голос", url: `${base}/voice`, icon: <MicIcon /> },
        { title: "Команда", url: `${base}/team`, icon: <UsersRoundIcon /> },
        { title: "Интеграции", url: `${base}/integrations`, icon: <PlugIcon /> },
        { title: "Тариф", url: `${base}/plan`, icon: <GaugeIcon /> },
      ]
    : []

  const adminNav = user.isAdmin
    ? [
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
