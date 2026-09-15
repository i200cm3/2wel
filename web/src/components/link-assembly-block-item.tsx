import { Link } from 'react-router-dom'
import { Layers, SquarePen } from 'lucide-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DEFAULT_HELLO_TEMPLATE, fillGuestText } from '@/content'
import type { AssemblyTraceEntry } from '@/lib/api'
import {
  AUDIENCE_TAG_OPTIONS,
  OBJECTION_TAG_OPTIONS,
  TOPIC_TAG_OPTIONS,
  tagOptionsFromValues,
} from '@/lib/blockMetaTags'
import { blockLogicLabelFromMeta } from '@/lib/blockLogicGroups'
import { cn } from '@/lib/utils'
import {
  defaultBlockMeta,
  migrateSequenceCues,
  sequenceDuration,
  type BlockMeta,
  type StorySequence,
} from '@/types/story'

function blockDurationLabel(seq: StorySequence) {
  return `${Math.round(sequenceDuration(seq))} сек.`
}

function libraryTagBadgeProps(kind: 'audience' | 'topic' | 'objection') {
  if (kind === 'objection') {
    return { variant: 'destructive' as const }
  }
  if (kind === 'topic') {
    return {
      variant: 'outline' as const,
      className:
        'border-green-600/30 bg-green-500/10 text-green-800 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-400',
    }
  }
  return { variant: 'outline' as const }
}

function blockMetaBadges(meta: BlockMeta, logicLabel: string) {
  type TagKind = 'logic' | 'audience' | 'topic' | 'objection'
  const items: Array<{ key: string; label: string; kind: TagKind; title: string }> = []

  if (logicLabel) {
    items.push({
      key: 'logic',
      label: logicLabel,
      kind: 'logic',
      title: 'Тип блока',
    })
  }

  for (const item of tagOptionsFromValues(meta.audienceTags, AUDIENCE_TAG_OPTIONS)) {
    items.push({
      key: `audience:${item.value}`,
      label: item.label,
      kind: 'audience',
      title: 'Аудитория — для кого блок',
    })
  }
  for (const item of tagOptionsFromValues(meta.topicTags, TOPIC_TAG_OPTIONS)) {
    items.push({
      key: `topic:${item.value}`,
      label: item.label,
      kind: 'topic',
      title: 'Тема контента',
    })
  }
  for (const item of tagOptionsFromValues(meta.objectionTags, OBJECTION_TAG_OPTIONS)) {
    items.push({
      key: `objection:${item.value}`,
      label: item.label,
      kind: 'objection',
      title: 'Возражение гостя',
    })
  }

  if (!items.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        if (item.kind === 'logic') {
          return (
            <Badge
              key={item.key}
              variant="secondary"
              title={item.title}
              className="max-w-full font-normal whitespace-normal"
            >
              {item.label}
            </Badge>
          )
        }
        return (
          <Badge key={item.key} title={item.title} {...libraryTagBadgeProps(item.kind)}>
            {item.label}
          </Badge>
        )
      })}
    </div>
  )
}

export type LinkAssemblyGuestFill = {
  guestName?: string
  hello?: string
  dates?: string
  room?: string
}

function fillCueText(template: string | undefined, guest?: LinkAssemblyGuestFill) {
  const raw = String(template ?? '').trim()
  if (!raw) return ''
  if (!guest) return raw
  return fillGuestText(raw, guest.guestName ?? '', guest.hello || DEFAULT_HELLO_TEMPLATE, {
    dates: guest.dates,
    room: guest.room,
  }).trim()
}

function CueCopy({
  caption,
  tts,
  captionHidden,
}: {
  caption: string
  tts: string
  captionHidden: boolean
}) {
  const same = Boolean(caption && tts && caption === tts)

  if (!caption && !tts) {
    return <p className="text-muted-foreground text-sm">Нет текста</p>
  }

  if (same) {
    return (
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {caption}
        {captionHidden ? (
          <span className="text-muted-foreground ml-1.5 text-xs">(титр скрыт)</span>
        ) : null}
      </p>
    )
  }

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-0.5">
        <span className="text-muted-foreground text-[11px]">
          Титр{captionHidden ? ' · скрыт' : ''}
        </span>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {caption || <span className="text-muted-foreground">—</span>}
        </p>
      </div>
      <div className="grid gap-0.5">
        <span className="text-muted-foreground text-[11px]">TTS</span>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {tts || <span className="text-muted-foreground">—</span>}
        </p>
      </div>
    </div>
  )
}

function editorHrefFor(base: string | undefined, blockId: string, cueId?: string) {
  if (!base) return undefined
  const params = new URLSearchParams({ seq: blockId })
  if (cueId) params.set('cue', cueId)
  return `${base}?${params.toString()}`
}

function OpenInEditorButton({ href, label }: { href: string; label?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? 'sm' : 'icon-sm'}
      className={label ? 'text-muted-foreground h-7 gap-1.5 px-2 text-xs' : 'text-muted-foreground'}
      title="Открыть в конструкторе · настройка титров"
      nativeButton={false}
      render={<Link to={href} />}
      onClick={(e) => e.stopPropagation()}
    >
      <SquarePen className="size-3.5" />
      {label ? <span>{label}</span> : <span className="sr-only">В конструктор</span>}
    </Button>
  )
}

export function LinkAssemblyBlockItem({
  entry,
  sequence,
  meta,
  guest,
  editorBasePath,
}: {
  entry: AssemblyTraceEntry
  sequence?: StorySequence
  meta?: BlockMeta
  guest?: LinkAssemblyGuestFill
  /** `/app/projects/.../templates/.../edit-v2` без query */
  editorBasePath?: string
}) {
  const blockMeta = meta ?? defaultBlockMeta()
  const logicLabel = blockLogicLabelFromMeta(blockMeta)
  const cues = sequence ? migrateSequenceCues(sequence) : []
  const hasCopy = cues.some((cue) => Boolean(cue.text?.trim() || cue.ttsText?.trim()))
  const blockEditorHref = editorHrefFor(editorBasePath, entry.id)

  if (!hasCopy) {
    return (
      <div className="flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-sm border">
          <Layers className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium break-words">{entry.label}</p>
          {blockMetaBadges(blockMeta, logicLabel)}
        </div>
        {sequence ? (
          <span className="text-muted-foreground shrink-0 self-center tabular-nums text-xs">
            {blockDurationLabel(sequence)}
          </span>
        ) : null}
        {blockEditorHref ? (
          <div className="shrink-0 self-center">
            <OpenInEditorButton href={blockEditorHref} />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Accordion className="rounded-lg border">
      <AccordionItem value={entry.id} className="border-0">
        <div className="flex w-full items-stretch">
          <div className="min-w-0 flex-1">
            <AccordionTrigger className="w-full items-center gap-2.5 px-3 py-2.5 hover:no-underline">
              <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-sm border">
                <Layers className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-left">
                <p className="font-medium break-words">{entry.label}</p>
                {blockMetaBadges(blockMeta, logicLabel)}
              </div>
              {sequence ? (
                <span className="text-muted-foreground shrink-0 tabular-nums text-xs">
                  {blockDurationLabel(sequence)}
                </span>
              ) : null}
            </AccordionTrigger>
          </div>
          {blockEditorHref ? (
            <div className="flex shrink-0 items-center border-l px-1.5">
              <OpenInEditorButton href={blockEditorHref} />
            </div>
          ) : null}
        </div>
        <AccordionContent className="px-3 pb-3">
          <ul className="divide-border border-border divide-y rounded-md border">
            {cues.map((cue, index) => {
              const caption = fillCueText(cue.text, guest)
              const tts = fillCueText(cue.ttsText, guest)
              if (!caption && !tts) return null
              const cueHref = editorHrefFor(editorBasePath, entry.id, cue.id)
              return (
                <li
                  key={cue.id}
                  className={cn('grid gap-2 px-3 py-2.5', cues.length === 1 && 'border-0')}
                >
                  <div className="flex items-center justify-between gap-2">
                    {cues.length > 1 ? (
                      <span className="text-muted-foreground text-[11px] tabular-nums">
                        Фраза {index + 1}
                      </span>
                    ) : (
                      <span />
                    )}
                    {cueHref ? <OpenInEditorButton href={cueHref} label="Титр" /> : null}
                  </div>
                  <CueCopy
                    caption={caption}
                    tts={tts}
                    captionHidden={cue.showText === false}
                  />
                </li>
              )
            })}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
