import { Fragment, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { ChevronDownIcon, CircleCheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { ContactChannelId, ProjectStats } from '@/lib/api'

const hourConfig = {
  opens: { label: 'Открытия', color: 'var(--chart-1)' },
} satisfies ChartConfig

const topicsConfig = {
  guests: { label: 'Гости', color: 'var(--chart-2)' },
} satisfies ChartConfig

const deviceConfig = {
  phone: { label: 'Телефон', color: 'var(--chart-1)' },
  tablet: { label: 'Планшет', color: 'var(--chart-2)' },
  desktop: { label: 'Компьютер', color: 'var(--chart-3)' },
} satisfies ChartConfig

const channelConfig = {
  whatsapp: { label: 'WhatsApp', color: 'var(--chart-1)' },
  telegram: { label: 'Telegram', color: 'var(--chart-2)' },
  max: { label: 'MAX', color: 'var(--chart-3)' },
  tel: { label: 'Звонок', color: 'var(--chart-4)' },
  sms: { label: 'SMS', color: 'var(--chart-5)' },
  site: { label: 'Сайт', color: 'var(--chart-1)' },
  other: { label: 'Ссылка', color: 'var(--chart-2)' },
} satisfies ChartConfig

const EVENT_LABEL: Record<string, string> = {
  open: 'Открыл ссылку',
  autoplay: 'Конец автопоказа → меню',
  menu: 'Зашёл в меню',
  whatsapp: 'WhatsApp',
  topic: 'Тема',
  contact: 'Контакт',
  none: 'Без действий',
}

const DEVICE_LABEL: Record<string, string> = {
  phone: 'Телефон',
  tablet: 'Планшет',
  desktop: 'Компьютер',
}

const CHANNEL_LABEL: Record<ContactChannelId, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  max: 'MAX',
  tel: 'Звонок',
  sms: 'SMS',
  site: 'Сайт',
  other: 'Ссылка',
}

const crmAfterConfig = {
  count: { label: 'Смен статуса', color: 'var(--chart-3)' },
} satisfies ChartConfig

const DEVICE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'] as const
const CHANNEL_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

function eventLabel(row: ProjectStats['recent'][number]) {
  if (row.type === 'topic') {
    const name = row.topicLabel || row.topic
    return name ? `Тема · ${name}` : 'Тема'
  }
  if (row.type === 'contact') {
    const name = row.topicLabel || row.topic
    return name ? `Контакт · ${name}` : 'Контакт'
  }
  return EVENT_LABEL[row.type] ?? row.type
}

function priorLabel(types: string[]) {
  if (!types.length) return '—'
  return types.map((type) => EVENT_LABEL[type] ?? type).join(' → ')
}

function formatDt(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type RecentEvent = ProjectStats['recent'][number]

type GuestActivity = {
  publicId: string
  guestName: string
  lastAt: string
  opened: boolean
  autoplay: boolean
  menu: boolean
  contacted: boolean
  topics: { id: string; label: string }[]
  device: string
  events: RecentEvent[]
}

function aggregateGuests(
  recent: RecentEvent[],
  unopened: { at: string; guestName: string; publicId: string }[] = [],
): GuestActivity[] {
  const byId = new Map<string, GuestActivity>()
  for (const row of recent) {
    let guest = byId.get(row.publicId)
    if (!guest) {
      guest = {
        publicId: row.publicId,
        guestName: row.guestName,
        lastAt: row.at,
        opened: false,
        autoplay: false,
        menu: false,
        contacted: false,
        topics: [],
        device: row.device,
        events: [],
      }
      byId.set(row.publicId, guest)
    }
    guest.events.push(row)
    if (row.at > guest.lastAt) {
      guest.lastAt = row.at
      guest.device = row.device
    }
    if (row.type === 'open') guest.opened = true
    if (row.type === 'autoplay') guest.autoplay = true
    if (row.type === 'menu') guest.menu = true
    if (row.type === 'whatsapp' || row.type === 'contact') guest.contacted = true
    if (row.type === 'topic') {
      const id = row.topic || row.topicLabel || 'topic'
      const label = row.topicLabel || row.topic || 'Тема'
      if (!guest.topics.some((t) => t.id === id)) {
        guest.topics.push({ id, label })
      }
    }
  }
  for (const guest of byId.values()) {
    guest.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    if (!guest.opened && (guest.autoplay || guest.menu || guest.contacted || guest.topics.length)) {
      guest.opened = true
    }
  }
  for (const row of unopened) {
    if (byId.has(row.publicId)) continue
    byId.set(row.publicId, {
      publicId: row.publicId,
      guestName: row.guestName,
      lastAt: row.at,
      opened: false,
      autoplay: false,
      menu: false,
      contacted: false,
      topics: [],
      device: '',
      events: [],
    })
  }
  return [...byId.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
}

const TOPIC_BADGE_LIMIT = 3

function TopicBadges({ topics }: { topics: GuestActivity['topics'] }) {
  if (!topics.length) {
    return <span className="text-muted-foreground text-xs">—</span>
  }
  const shown = topics.slice(0, TOPIC_BADGE_LIMIT)
  const rest = topics.length - shown.length
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t.id} variant="secondary" className="font-normal">
          {t.label}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="outline" className="text-muted-foreground font-normal">
          +{rest}
        </Badge>
      ) : null}
    </div>
  )
}

function StatusBadges({ guest }: { guest: GuestActivity }) {
  return (
    <div className="flex flex-wrap gap-1">
      {guest.opened ? (
        <Badge
          variant="outline"
          className="px-1.5 text-muted-foreground"
          title="Открыл персональную ссылку"
        >
          <CircleCheckIcon className="fill-green-500 dark:fill-green-400" />
          Открыл ссылку
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="text-muted-foreground px-1.5 font-normal"
          title="Ссылку выдали, но ещё не открывали"
        >
          Не открыл
        </Badge>
      )}
      {guest.contacted ? (
        <Badge
          variant="outline"
          className="px-1.5 font-normal"
          title="Нажал WhatsApp, MAX, звонок или другую кнопку связи"
        >
          Нажал связь
        </Badge>
      ) : null}
    </div>
  )
}

export function AnalyticsPanels({
  stats,
  periodLabel,
}: {
  stats: ProjectStats
  periodLabel: string
}) {
  const devices = stats.devices ?? { phone: 0, tablet: 0, desktop: 0 }
  const hours = stats.hours ?? []
  const recent = stats.recent ?? []
  const unopened = stats.unopened ?? []
  const guests = useMemo(() => aggregateGuests(recent, unopened), [recent, unopened])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [guestQuery, setGuestQuery] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const topicFilterOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const guest of guests) {
      for (const topic of guest.topics) {
        if (!map.has(topic.id)) map.set(topic.id, topic.label)
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  }, [guests])
  const filteredGuests = useMemo(() => {
    const q = guestQuery.trim().toLocaleLowerCase('ru-RU')
    return guests.filter((guest) => {
      if (q) {
        const hay = `${guest.guestName} ${guest.publicId}`.toLocaleLowerCase('ru-RU')
        if (!hay.includes(q)) return false
      }
      if (topicFilter === '__none__') return guest.topics.length === 0
      if (topicFilter) return guest.topics.some((t) => t.id === topicFilter)
      return true
    })
  }, [guests, guestQuery, topicFilter])
  const topics = stats.topics ?? []
  const channels = stats.channels ?? []
  const crmAfter = stats.crmAfter ?? []
  const crmRecent = stats.crmRecent ?? []
  const peak = hours.reduce(
    (best, row) => (row.opens > best.opens ? row : best),
    { hour: 0, opens: 0 },
  )

  const deviceData = (['phone', 'tablet', 'desktop'] as const)
    .map((key) => ({
      name: key,
      value: devices[key],
      fill: `var(--color-${key})`,
    }))
    .filter((row) => row.value > 0)

  const channelData = channels.map((row, index) => ({
    name: row.id,
    value: row.clicks,
    fill: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
  }))

  const topicData = topics.map((row) => ({
    label: row.label,
    guests: row.guests,
    share: Math.round(row.share * 100),
  }))

  const crmAfterData = crmAfter.map((row) => ({
    label: EVENT_LABEL[row.eventType] ?? row.eventType,
    count: row.count,
  }))

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2 lg:px-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-sans">Темы</CardTitle>
          <CardDescription>
            Что открывали из меню · доля от тех, кто открыл ссылку · {periodLabel}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topicData.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Пока никто не открыл раздел. Когда гость нажмёт тему в меню — она появится здесь.
            </p>
          ) : (
            <ChartContainer config={topicsConfig} className="aspect-auto h-[220px] w-full">
              <BarChart data={topicData} layout="vertical" margin={{ left: 8, right: 12 }}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="label"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                  tickMargin={6}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, item) => (
                        <>
                          <span className="text-muted-foreground">Гости</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {value}
                            {item?.payload?.share != null ? ` · ${item.payload.share}%` : ''}
                          </span>
                        </>
                      )}
                      hideLabel
                    />
                  }
                />
                <Bar dataKey="guests" fill="var(--color-guests)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Время суток</CardTitle>
          <CardDescription>
            {peak.opens
              ? `Пик ${String(peak.hour).padStart(2, '0')}:00 · Москва`
              : 'Открытия по часам, Москва'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={hourConfig} className="aspect-auto h-[180px] w-full">
            <BarChart data={hours}>
              <XAxis
                dataKey="hour"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval={2}
                tickFormatter={(value) => `${value}`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => `${String(value).padStart(2, '0')}:00`}
                    indicator="dot"
                  />
                }
              />
              <Bar dataKey="opens" fill="var(--color-opens)" radius={2} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Устройство</CardTitle>
          <CardDescription>Открытия · {periodLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          {deviceData.length === 0 ? (
            <p className="text-muted-foreground text-sm">Пока нет открытий.</p>
          ) : (
            <ChartContainer config={deviceConfig} className="mx-auto aspect-square h-[200px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="name" />} />
                <Pie data={deviceData} dataKey="value" nameKey="name" innerRadius={48} strokeWidth={2}>
                  {deviceData.map((row, index) => (
                    <Cell key={row.name} fill={DEVICE_COLORS[index % DEVICE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
          {deviceData.length > 0 ? (
            <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
              {deviceData.map((row) => (
                <li key={row.name} className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: row.fill }}
                  />
                  <span className="text-muted-foreground">{DEVICE_LABEL[row.name]}</span>
                  <span className="tabular-nums">{row.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Каналы контакта</CardTitle>
          <CardDescription>Куда нажали из меню · {periodLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          {channelData.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Пока нет кликов по кнопкам связи. WhatsApp, Telegram и остальные появятся здесь.
            </p>
          ) : (
            <ChartContainer config={channelConfig} className="mx-auto aspect-square h-[200px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="name" />} />
                <Pie data={channelData} dataKey="value" nameKey="name" innerRadius={48} strokeWidth={2}>
                  {channelData.map((row) => (
                    <Cell key={row.name} fill={row.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          )}
          {channelData.length > 0 ? (
            <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
              {channelData.map((row) => (
                <li key={row.name} className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: row.fill }}
                  />
                  <span className="text-muted-foreground">
                    {CHANNEL_LABEL[row.name as ContactChannelId] ?? row.name}
                  </span>
                  <span className="tabular-nums">{row.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-sans">Статус CRM после действий</CardTitle>
          <CardDescription>
            Когда webhook сменил этап сделки — какое последнее действие гостя уже было ·{' '}
            {periodLabel}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {crmAfterData.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Пока нет смен статуса из amo. Они появятся, когда сделка сдвинется по воронке.
            </p>
          ) : (
            <ChartContainer config={crmAfterConfig} className="aspect-auto h-[200px] w-full">
              <BarChart data={crmAfterData} layout="vertical" margin={{ left: 8, right: 12 }}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="label"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  width={110}
                  tickMargin={6}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel indicator="dot" />}
                />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Когда</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>После</TableHead>
                  <TableHead>Уже было</TableHead>
                  <TableHead>Гость</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crmRecent.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Нет записей за период.
                    </TableCell>
                  </TableRow>
                ) : (
                  crmRecent.map((row, index) => (
                    <TableRow key={`${row.at}-${row.publicId}-${index}`}>
                      <TableCell className="whitespace-nowrap">{formatDt(row.at)}</TableCell>
                      <TableCell>
                        {row.statusLabel || row.statusId}
                        {row.statusLabel ? (
                          <code className="text-muted-foreground ml-1 text-xs">{row.statusId}</code>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.lastEventType
                          ? EVENT_LABEL[row.lastEventType] ?? row.lastEventType
                          : 'Без действий'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {priorLabel(row.priorTypes)}
                      </TableCell>
                      <TableCell>
                        {row.guestName}{' '}
                        <code className="text-muted-foreground text-xs">{row.publicId}</code>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-sans">Последние гости</CardTitle>
          <CardDescription>
            {periodLabel} · одна строка на гостя · клик — лог действий
          </CardDescription>
          <CardAction className="flex w-full max-w-sm flex-col gap-2 self-start">
            <Input
              value={guestQuery}
              onChange={(e) => setGuestQuery(e.target.value)}
              placeholder="Имя или id ссылки"
              aria-label="Фильтр по имени или id"
            />
            <NativeSelect
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              aria-label="Фильтр по разделу"
              className="w-full"
            >
              <NativeSelectOption value="">Все разделы</NativeSelectOption>
              <NativeSelectOption value="__none__">Без разделов</NativeSelectOption>
              {topicFilterOptions.map(([id, label]) => (
                <NativeSelectOption key={id} value={id}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {guestQuery || topicFilter ? (
              <span className="text-muted-foreground text-right text-xs whitespace-nowrap">
                Найдено: {filteredGuests.length}
              </span>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Гость</TableHead>
                  <TableHead title="Открыл ссылку или нет · нажал кнопку связи">
                    Статус
                  </TableHead>
                  <TableHead title="Какие разделы из меню открывал гость">
                    Открытые разделы
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Активность</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Пока нет событий. Откройте персональную ссылку.
                    </TableCell>
                  </TableRow>
                ) : filteredGuests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Никого не найдено по фильтру.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGuests.map((guest) => {
                    const open = expandedId === guest.publicId
                    return (
                      <Fragment key={guest.publicId}>
                        <TableRow
                          className="hover:bg-muted/40 cursor-pointer"
                          onClick={() =>
                            setExpandedId(open ? null : guest.publicId)
                          }
                          aria-expanded={open}
                        >
                          <TableCell className="w-8 pr-0">
                            <ChevronDownIcon
                              className={cn(
                                'text-muted-foreground size-4 transition-transform',
                                open && 'rotate-180',
                              )}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{guest.guestName}</div>
                            <code className="text-muted-foreground text-xs">
                              {guest.publicId}
                            </code>
                          </TableCell>
                          <TableCell>
                            <StatusBadges guest={guest} />
                          </TableCell>
                          <TableCell>
                            <TopicBadges topics={guest.topics} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div>{formatDt(guest.lastAt)}</div>
                            <div className="text-muted-foreground text-xs">
                              {guest.opened
                                ? DEVICE_LABEL[guest.device] ?? guest.device
                                : 'выдана'}
                            </div>
                          </TableCell>
                        </TableRow>
                        {open ? (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={5} className="p-3">
                              {guest.events.length === 0 ? (
                                <p className="text-muted-foreground px-2 py-1 text-sm">
                                  Ссылку ещё не открывали
                                </p>
                              ) : (
                              <div className="border-border bg-background overflow-hidden rounded-lg border">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                      <TableHead className="h-8 text-xs">Дата</TableHead>
                                      <TableHead className="h-8 text-xs">Действие</TableHead>
                                      <TableHead className="h-8 text-xs">Устройство</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {guest.events.map((row, index) => (
                                      <TableRow
                                        key={`${row.at}-${row.type}-${index}`}
                                        className="hover:bg-muted/40"
                                      >
                                        <TableCell className="text-muted-foreground py-2 text-xs whitespace-nowrap tabular-nums">
                                          {formatDt(row.at)}
                                        </TableCell>
                                        <TableCell className="py-2 text-sm">
                                          {eventLabel(row)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground py-2 text-xs">
                                          {DEVICE_LABEL[row.device] ?? row.device}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
