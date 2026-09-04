import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropertyConfig } from '@/types/story'

const MAX_STACK = 80
const COALESCE_MS = 450

function cloneConfig(value: PropertyConfig): PropertyConfig {
  return structuredClone(value)
}

export type ConfigUpdater = PropertyConfig | ((prev: PropertyConfig) => PropertyConfig)

/**
 * Undo/redo для конфига таймлайна. Быстрые правки (слайдер, ввод) сливаются в один шаг.
 *
 * commit сразу обновляет внутренний ref и принимает updater `(prev) => next`.
 * Иначе асинхронные правки раздела (tts duration, trim) читают props до ре-рендера
 * и затирают только что изменённое меню.
 */
export function useEditorHistory(
  config: PropertyConfig,
  onChange: (next: PropertyConfig) => void,
  resetKey: string,
) {
  const past = useRef<PropertyConfig[]>([])
  const future = useRef<PropertyConfig[]>([])
  const applying = useRef(false)
  const groupOpen = useRef(false)
  const groupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configRef = useRef(config)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [epoch, setEpoch] = useState(0)

  const bump = () => setEpoch((n) => n + 1)

  const closeGroup = useCallback(() => {
    groupOpen.current = false
    if (groupTimer.current) {
      clearTimeout(groupTimer.current)
      groupTimer.current = null
    }
  }, [])

  useEffect(() => {
    past.current = []
    future.current = []
    applying.current = false
    configRef.current = config
    closeGroup()
    bump()
    // только смена шаблона/проекта — полный сброс стека
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey drives reset; config snapshotted once
  }, [resetKey, closeGroup])

  // Подтверждение от родителя или внешний reset/load — без затирания более нового commit.
  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => () => closeGroup(), [closeGroup])

  const commit = useCallback((next: ConfigUpdater) => {
    const prev = configRef.current
    const resolved = typeof next === 'function' ? next(prev) : next
    configRef.current = resolved
    if (!applying.current) {
      if (!groupOpen.current) {
        past.current.push(cloneConfig(prev))
        if (past.current.length > MAX_STACK) past.current.shift()
        future.current = []
        groupOpen.current = true
        bump()
      }
      if (groupTimer.current) clearTimeout(groupTimer.current)
      groupTimer.current = setTimeout(() => {
        groupOpen.current = false
        groupTimer.current = null
      }, COALESCE_MS)
    }
    onChangeRef.current(resolved)
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    closeGroup()
    future.current.push(cloneConfig(configRef.current))
    applying.current = true
    configRef.current = prev
    onChangeRef.current(prev)
    applying.current = false
    bump()
  }, [closeGroup])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    closeGroup()
    past.current.push(cloneConfig(configRef.current))
    applying.current = true
    configRef.current = next
    onChangeRef.current(next)
    applying.current = false
    bump()
  }, [closeGroup])

  return {
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    hasUndo: () => past.current.length > 0,
    hasRedo: () => future.current.length > 0,
    epoch,
    getConfig: () => configRef.current,
  }
}
