import { Mic, Music, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProjectAudioItem } from './editorTypes'
import { mediaFileName } from './timelineMath'

export function LibraryAudioRow({
  item,
  playing,
  durationSec,
  onToggle,
}: {
  item: ProjectAudioItem
  playing: boolean
  durationSec?: number
  onToggle: () => void
}) {
  const usage = item.kind === 'music' ? 'Фон плеера' : item.usages.join(' · ')
  const duration =
    durationSec != null && Number.isFinite(durationSec) && durationSec > 0
      ? `${durationSec.toFixed(1)}с`
      : null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2 py-2">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={onToggle}
        title={playing ? 'Стоп' : 'Прослушать'}
        aria-label={playing ? 'Стоп' : `Прослушать ${mediaFileName(item.src)}`}
      >
        {playing ? (
          <Square aria-hidden />
        ) : (
          <Play aria-hidden fill="currentColor" strokeWidth={0} />
        )}
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{mediaFileName(item.src)}</p>
        <p className="text-muted-foreground truncate text-xs">
          {usage}
          {duration ? ` · ${duration}` : ''}
        </p>
      </div>
      {item.kind === 'music' ? (
        <Music className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      ) : (
        <Mic className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      )}
    </div>
  )
}
