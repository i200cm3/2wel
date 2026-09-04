import { useEffect, useState } from 'react'
import { Link, Navigate, useOutletContext } from 'react-router-dom'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  fetchAdminTtsUsage,
  type AdminElevenlabsBalance,
  type AdminTtsUsageUser,
} from '@/lib/api'

const PERIODS = [
  { label: 'Всё время', days: 0 },
  { label: '30 дней', days: 30 },
  { label: '7 дней', days: 7 },
] as const

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

function formatChars(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value)
}

function BalanceCard({ balance }: { balance: AdminElevenlabsBalance | null }) {
  if (!balance) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Баланс ElevenLabs</CardTitle>
          <CardDescription>Загрузка…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!balance.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Баланс ElevenLabs</CardTitle>
          <CardDescription className="text-destructive">{balance.error}</CardDescription>
        </CardHeader>
        {balance.detail ? (
          <CardContent>
            <p className="text-muted-foreground text-xs break-words">{balance.detail}</p>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  const usedPct =
    balance.characterLimit > 0
      ? Math.min(100, Math.round((balance.characterCount / balance.characterLimit) * 100))
      : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Баланс ElevenLabs</CardTitle>
        <CardDescription>
          {balance.tier ? `Тариф: ${balance.tier}` : 'Подписка'}
          {balance.status ? ` · ${balance.status}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-muted-foreground text-xs">Осталось</div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatChars(balance.charactersRemaining)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Использовано</div>
            <div className="text-lg font-medium tabular-nums">
              {formatChars(balance.characterCount)}
              <span className="text-muted-foreground text-sm font-normal">
                {' '}
                / {formatChars(balance.characterLimit)}
              </span>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Сброс квоты</div>
            <div className="text-sm">{formatDt(balance.nextResetAt)}</div>
          </div>
        </div>
        <div className="bg-muted h-2 overflow-hidden rounded-full">
          <div className="bg-foreground h-full transition-all" style={{ width: `${usedPct}%` }} />
        </div>
        <p className="text-muted-foreground text-xs">{usedPct}% квоты за текущий период</p>
      </CardContent>
    </Card>
  )
}

export function AdminTtsUsagePage() {
  const { user } = useOutletContext<CabinetOutlet>()
  const [days, setDays] = useState(0)
  const [users, setUsers] = useState<AdminTtsUsageUser[] | null>(null)
  const [totals, setTotals] = useState({ characters: 0, generations: 0 })
  const [balance, setBalance] = useState<AdminElevenlabsBalance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!user.isAdmin) return
    let cancelled = false
    setPending(true)
    void fetchAdminTtsUsage(days)
      .then((data) => {
        if (cancelled) return
        setUsers(data.users)
        setTotals(data.totals)
        setBalance(data.elevenlabs)
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
  }, [days, user.isAdmin])

  if (!user.isAdmin) {
    return <Navigate to="/app" replace />
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Расход TTS</h1>
        <p className="text-muted-foreground text-sm">
          Символы ElevenLabs по пользователям (только реальные генерации, без кэша).
        </p>
      </div>

      <BalanceCard balance={balance} />

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((period) => (
          <Button
            key={period.days}
            type="button"
            size="sm"
            variant={days === period.days ? 'default' : 'outline'}
            onClick={() => setDays(period.days)}
          >
            {period.label}
          </Button>
        ))}
        {pending ? <span className="text-muted-foreground text-xs">Обновление…</span> : null}
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
        <span>
          Всего символов:{' '}
          <span className="text-foreground font-medium tabular-nums">{formatChars(totals.characters)}</span>
        </span>
        <span>
          Генераций:{' '}
          <span className="text-foreground font-medium tabular-nums">{formatChars(totals.generations)}</span>
        </span>
      </div>

      {users == null ? (
        <p className="text-muted-foreground text-sm">Загрузка…</p>
      ) : users.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Пока нет учтённых генераций TTS за выбранный период.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table className="table-fixed">
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Пользователь</TableHead>
                <TableHead>Почта</TableHead>
                <TableHead>Символы</TableHead>
                <TableHead>Генерации</TableHead>
                <TableHead>Последняя</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="overflow-hidden">
                    <Link
                      to={`/app/users/${item.id}`}
                      className="font-medium hover:underline"
                    >
                      {item.name || item.login}
                    </Link>
                    <div className="text-muted-foreground truncate text-xs">{item.login}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground overflow-hidden text-sm text-ellipsis">
                    {item.email || '—'}
                  </TableCell>
                  <TableCell className="tabular-nums font-medium">
                    {formatChars(item.characters)}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatChars(item.generations)}</TableCell>
                  <TableCell className="text-muted-foreground overflow-hidden text-sm text-ellipsis">
                    {formatDt(item.lastAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Учёт начинается с момента обновления: прошлые генерации не восстанавливаются.
        <Badge variant="secondary" className="ml-2">
          ElevenLabs
        </Badge>
      </p>
    </div>
  )
}
