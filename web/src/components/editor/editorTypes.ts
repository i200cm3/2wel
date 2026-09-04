import type { PropertyConfig } from '@/types/story'
import { listMenus } from '@/types/story'
import { backgroundMusicSrc } from './timelineMath'

export const inspectorShellClass =
  'mt-4 grid grid-cols-1 items-start gap-4 rounded-xl border border-border bg-muted p-4'

export const inspectorGridClass = 'min-[901px]:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.7fr)]'

/** Превью «прилипает» к верху скролла, пока настройки уезжают вниз. */
export const inspectorStageClass =
  'editor-inspector-stage min-[901px]:sticky min-[901px]:top-4 min-[901px]:self-start'

export const inspectorFieldsClass = 'flex min-w-0 flex-col gap-2.5'

export type LibraryTab = 'photos' | 'audio'

export type InspectorTab = 'motion' | 'frame'

export type TrackContextMenuState = {
  kind: 'clip' | 'cue'
  id: string
  x: number
  y: number
}

export type ProjectAudioItem = {
  src: string
  kind: 'music' | 'tts'
  usages: string[]
}

export function projectAudioItems(config: PropertyConfig, projectCode?: string): ProjectAudioItem[] {
  const ttsUsages = new Map<string, string[]>()
  const addTts = (src: string | undefined, label: string) => {
    const clean = src?.trim()
    if (!clean) return
    const list = ttsUsages.get(clean) ?? []
    if (!list.includes(label)) list.push(label)
    ttsUsages.set(clean, list)
  }
  for (const menu of listMenus(config)) {
    addTts(menu.menuTtsSrc, `Меню: ${menu.label}`)
  }
  for (const seq of Object.values(config.sequences)) {
    for (const cue of seq.cues ?? []) addTts(cue.ttsSrc, seq.label)
  }
  const tts = [...ttsUsages.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([src, usages]) => ({ src, kind: 'tts' as const, usages }))
  return [
    {
      src: backgroundMusicSrc(projectCode, config.musicSrc),
      kind: 'music',
      usages: ['Плеер'],
    },
    ...tts,
  ]
}
