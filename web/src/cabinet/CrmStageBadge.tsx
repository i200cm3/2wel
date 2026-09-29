import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/** Только имя стадии; воронка в UI обычно шумит. */
export function crmStageLabel(statusName?: string | null) {
  const name = String(statusName ?? '').trim()
  return name || null
}

const STAGE_OPEN_TONES = [
  'border-sky-200/80 bg-sky-50 text-sky-800/80 dark:border-sky-500/40 dark:bg-sky-950/50 dark:text-sky-300',
  'border-amber-200/80 bg-amber-50 text-amber-900/75 dark:border-amber-500/40 dark:bg-amber-950/45 dark:text-amber-300',
  'border-violet-200/70 bg-violet-50 text-violet-800/75 dark:border-violet-500/40 dark:bg-violet-950/45 dark:text-violet-300',
  'border-teal-200/80 bg-teal-50 text-teal-800/80 dark:border-teal-500/40 dark:bg-teal-950/45 dark:text-teal-300',
  'border-orange-200/70 bg-orange-50 text-orange-900/75 dark:border-orange-500/40 dark:bg-orange-950/45 dark:text-orange-300',
  'border-indigo-200/70 bg-indigo-50 text-indigo-800/75 dark:border-indigo-500/40 dark:bg-indigo-950/45 dark:text-indigo-300',
] as const

function hashStageKey(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

/** Светлая тема — пастель; тёмная — глубокий фон + светлый текст (как в макете таймлайна). */
export function crmStageToneClass(opts: {
  statusType?: number | null
  statusId?: string | null
  statusName?: string | null
}) {
  const name = String(opts.statusName ?? '')
  const type = Number(opts.statusType)
  if (type === 1 || /успешн|забронир/i.test(name)) {
    return 'border-emerald-200/90 bg-emerald-50 text-emerald-800/85 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300'
  }
  if (type === 2 || /не реализован/i.test(name)) {
    return 'border-stone-200 bg-stone-100/90 text-stone-600 dark:border-stone-600/60 dark:bg-stone-900/70 dark:text-stone-300'
  }
  if (/нов(ая|ый|ое)?\b|заявк/i.test(name)) {
    return 'border-sky-200/80 bg-sky-50 text-sky-800/80 dark:border-sky-500/40 dark:bg-sky-950/50 dark:text-sky-300'
  }
  if (/отработан|предложен|квалиф|оплат/i.test(name)) {
    return 'border-amber-200/80 bg-amber-50 text-amber-900/75 dark:border-amber-500/40 dark:bg-amber-950/45 dark:text-amber-300'
  }
  const key = String(opts.statusId || name || '0')
  return STAGE_OPEN_TONES[hashStageKey(key) % STAGE_OPEN_TONES.length]!
}

export function CrmStageBadge({
  statusName,
  statusType,
  statusId,
  className,
}: {
  statusName?: string | null
  statusType?: number | null
  statusId?: string | null
  className?: string
}) {
  const label = crmStageLabel(statusName)
  if (!label) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <span
      className={cn(
        'inline-flex max-w-full rounded-md border px-1.5 py-0.5 text-xs leading-snug font-medium',
        crmStageToneClass({ statusType, statusId, statusName }),
        className,
      )}
    >
      <span className="line-clamp-2">{label}</span>
    </span>
  )
}

/** Тип звонка: светлая пастель / в dark — насыщенный синий. */
export function CallIntentChip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        'border-blue-200/80 bg-blue-50 text-blue-700/90',
        'dark:border-blue-500/30 dark:bg-blue-900/80 dark:text-blue-100',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function CallFollowChip({
  status,
  className,
}: {
  status?: 'open' | 'done' | null
  className?: string
}) {
  const label =
    status === 'done' ? 'Дожать · сделано' : status === 'open' ? 'Дожать · открыто' : 'Дожать'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        status === 'done'
          ? 'border-emerald-200/90 bg-emerald-50 text-emerald-800/85 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-600/70 dark:bg-stone-800/80 dark:text-stone-300',
        className,
      )}
    >
      {label}
    </span>
  )
}

/** Актуальный follow-up по сделке: open важнее done. */
export function leadFollowUpStatus(
  calls: Array<{ followUpStatus?: 'open' | 'done' | null } | null | undefined> | null | undefined,
): 'open' | 'done' | null {
  const list = calls || []
  if (list.some((call) => call?.followUpStatus === 'open')) return 'open'
  if (list.some((call) => call?.followUpStatus === 'done')) return 'done'
  return null
}
