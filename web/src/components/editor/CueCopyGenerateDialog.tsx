import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { generateCueCopy } from '@/lib/api'
import {
  AUDIENCE_TAG_OPTIONS,
  OBJECTION_TAG_OPTIONS,
  TOPIC_TAG_OPTIONS,
  tagOptionsFromValues,
} from '@/lib/blockMetaTags'
import type { BlockMeta, PropertyBrand, StoryCue, StorySequence } from '@/types/story'

type Draft = {
  title: string
  text: string
  ttsText: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  brand: PropertyBrand
  copyFacts?: string
  sequence: StorySequence
  blockMeta: BlockMeta
  cues: StoryCue[]
  cueIndex: number
  onApply: (draft: Draft) => void
}

export function CueCopyGenerateDialog({
  open,
  onOpenChange,
  brand,
  copyFacts = '',
  sequence,
  blockMeta,
  cues,
  cueIndex,
  onApply,
}: Props) {
  const selected = cues[cueIndex]
  const isFirstCue = cueIndex === 0
  const [updateTitle, setUpdateTitle] = useState(isFirstCue)
  const [draft, setDraft] = useState<Draft>({
    title: sequence.title ?? '',
    text: selected?.text ?? '',
    ttsText: selected?.ttsText ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUpdateTitle(cueIndex === 0)
    setDraft({
      title: sequence.title ?? '',
      text: selected?.text ?? '',
      ttsText: selected?.ttsText ?? '',
    })
    setError(null)
    setModel(null)
  }, [open, cueIndex, sequence.title, selected?.id, selected?.text, selected?.ttsText])

  const tags = useMemo(() => {
    return [
      ...tagOptionsFromValues(blockMeta.audienceTags, AUDIENCE_TAG_OPTIONS).map((item) => ({
        ...item,
        kind: 'audience' as const,
      })),
      ...tagOptionsFromValues(blockMeta.topicTags, TOPIC_TAG_OPTIONS).map((item) => ({
        ...item,
        kind: 'topic' as const,
      })),
      ...tagOptionsFromValues(blockMeta.objectionTags, OBJECTION_TAG_OPTIONS).map((item) => ({
        ...item,
        kind: 'objection' as const,
      })),
    ]
  }, [blockMeta.audienceTags, blockMeta.objectionTags, blockMeta.topicTags])

  const factsEmpty = !copyFacts.trim()

  const handleGenerate = async () => {
    if (busy || !selected) return
    setBusy(true)
    setError(null)
    try {
      const result = await generateCueCopy({
        brand: {
          name: brand.name,
          fullName: brand.fullName,
          city: brand.city,
          site: brand.site,
        },
        copyFacts,
        block: {
          label: sequence.label,
          group: blockMeta.group,
          subgroup: blockMeta.subgroup,
          audienceTags: blockMeta.audienceTags,
          topicTags: blockMeta.topicTags,
          objectionTags: blockMeta.objectionTags,
          slotFields: blockMeta.slotFields,
          title: sequence.title,
          cues: cues.map((cue) => ({
            text: cue.text,
            ttsText: cue.ttsText,
          })),
        },
        cueIndex,
        updateTitle,
      })
      setDraft({
        title: result.title ?? sequence.title ?? '',
        text: result.cue.text,
        ttsText: result.cue.ttsText,
      })
      setModel(result.model ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сгенерировать')
    } finally {
      setBusy(false)
    }
  }

  const handleSave = () => {
    onApply({
      title: updateTitle ? draft.title : sequence.title ?? '',
      text: draft.text,
      ttsText: draft.ttsText,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(calc(100vw-2rem),36rem)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>ИИ · титр и заголовок</DialogTitle>
          <DialogDescription>
            {sequence.label || 'Блок'} · титр {cueIndex + 1} из {cues.length}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-1.5">
            {tags.length ? (
              tags.map((tag) => (
                <Badge key={`${tag.kind}-${tag.value}`} variant="secondary">
                  {tag.label}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground text-xs">Теги блока не заданы</span>
            )}
          </div>

          {factsEmpty ? (
            <p className="text-amber-700 dark:text-amber-400 text-xs">
              Факты пустые — заполните вкладку «Параметры генерации», иначе тексты будут общими.
            </p>
          ) : null}

          <Field orientation="horizontal" className="items-center">
            <Checkbox
              id="cue-ai-update-title"
              checked={updateTitle}
              onCheckedChange={(checked) => setUpdateTitle(checked === true)}
            />
            <FieldLabel htmlFor="cue-ai-update-title">Также обновить заголовок блока</FieldLabel>
          </Field>

          {updateTitle ? (
            <Field>
              <FieldLabel htmlFor="cue-ai-title">Заголовок</FieldLabel>
              <Input
                id="cue-ai-title"
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              />
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="cue-ai-text">Титр</FieldLabel>
            <Textarea
              id="cue-ai-text"
              rows={3}
              value={draft.text}
              onChange={(e) => setDraft((prev) => ({ ...prev, text: e.target.value }))}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="cue-ai-tts">Озвучка</FieldLabel>
            <Textarea
              id="cue-ai-tts"
              rows={4}
              value={draft.ttsText}
              onChange={(e) => setDraft((prev) => ({ ...prev, ttsText: e.target.value }))}
            />
            <FieldDescription>
              Можно генерировать несколько раз, затем сохранить в черновик блока.
              {model ? ` · ${model}` : ''}
            </FieldDescription>
          </Field>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => void handleGenerate()} disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              Сгенерировать
            </Button>
            <Button type="button" onClick={handleSave} disabled={busy || (!draft.text.trim() && !draft.ttsText.trim())}>
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
