import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'

type Props = {
  label: string
  /** 0–100. `null` — неопределённый ход, полоска всё равно бежит. */
  value: number | null
  overlay?: boolean
}

export function PlayerLoading({ label, value, overlay = false }: Props) {
  return (
    <div
      className={overlay ? 'start-gate' : 'app boot'}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Progress
        value={value}
        className="boot-progress w-full max-w-xs flex-col flex-nowrap gap-2"
      >
        <ProgressLabel className="w-full text-center">{label}</ProgressLabel>
        {value != null ? <ProgressValue className="ml-0 w-full text-center" /> : null}
      </Progress>
    </div>
  )
}
