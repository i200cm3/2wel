import { Layers } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import type { AssemblyTraceEntry } from '@/lib/api'
import {
  AUDIENCE_TAG_OPTIONS,
  OBJECTION_TAG_OPTIONS,
  TOPIC_TAG_OPTIONS,
  tagOptionsFromValues,
} from '@/lib/blockMetaTags'
import { blockLogicLabelFromMeta } from '@/lib/blockLogicGroups'
import {
  defaultBlockMeta,
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

export function LinkAssemblyBlockItem({
  entry,
  sequence,
  meta,
}: {
  entry: AssemblyTraceEntry
  sequence?: StorySequence
  meta?: BlockMeta
}) {
  const blockMeta = meta ?? defaultBlockMeta()
  const logicLabel = blockLogicLabelFromMeta(blockMeta)

  return (
    <Item variant="outline">
      <ItemMedia variant="icon" className="size-8 rounded-sm border bg-muted">
        <Layers />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="line-clamp-none break-words">{entry.label}</ItemTitle>
        <ItemDescription className="line-clamp-none">{blockMetaBadges(blockMeta, logicLabel)}</ItemDescription>
      </ItemContent>
      {sequence ? (
        <ItemContent className="flex-none text-center">
          <ItemDescription className="tabular-nums whitespace-nowrap">
            {blockDurationLabel(sequence)}
          </ItemDescription>
        </ItemContent>
      ) : null}
    </Item>
  )
}
