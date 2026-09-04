import { useMemo } from 'react'
import { DEFAULT_GUEST_NAME, displayGuestName } from '../content'

export function useGuestName(fallback = DEFAULT_GUEST_NAME) {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('name')?.trim()
    return displayGuestName(raw || fallback)
  }, [fallback])
}
