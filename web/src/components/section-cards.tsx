import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ProjectStats } from "@/lib/api"
import { EyeIcon, LayoutGridIcon, MessageCircleIcon, PlayIcon } from "lucide-react"

const cardClass = "@container/card"

function pct(part: number, whole: number) {
  if (!whole) return "—"
  return `${Math.round((part / whole) * 100)}%`
}

export function SectionCards({
  stats,
  periodLabel,
}: {
  stats: ProjectStats
  status?: string
  periodLabel: string
}) {
  const funnel = stats.funnel ?? { open: 0, autoplay: 0, menu: 0, whatsapp: 0, contact: 0 }
  const opened = funnel.open
  const contacts = funnel.contact ?? funnel.whatsapp
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <Card className={cardClass}>
        <CardHeader>
          <CardDescription>Открыл</CardDescription>
          <CardTitle className="font-sans text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {opened}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <EyeIcon />
              {stats.openedLinks} ссылок
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">
            {periodLabel} · {stats.links} выдано всего
          </div>
        </CardFooter>
      </Card>
      <Card className={cardClass}>
        <CardHeader>
          <CardDescription>Досмотрел автопоказ</CardDescription>
          <CardTitle className="font-sans text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {funnel.autoplay}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <PlayIcon />
              {pct(funnel.autoplay, opened)}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">Дошёл до конца вступительного ролика</div>
        </CardFooter>
      </Card>
      <Card className={cardClass}>
        <CardHeader>
          <CardDescription>Зашёл в меню</CardDescription>
          <CardTitle className="font-sans text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {funnel.menu}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <LayoutGridIcon />
              {pct(funnel.menu, opened)}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">Выбор разделов после автопоказа или с паузы</div>
        </CardFooter>
      </Card>
      <Card className={cardClass}>
        <CardHeader>
          <CardDescription>Связь</CardDescription>
          <CardTitle className="font-sans text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {contacts}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <MessageCircleIcon />
              {pct(contacts, opened)}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">
            Кликнул кнопку связи (WhatsApp, Telegram, MAX, звонок, SMS…)
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
