import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { applyColorTheme, getColorTheme, toggleColorTheme } from '@/lib/theme'

/** Кнопка как на https://ui.shadcn.com/blocks/login */
export function ModeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    applyColorTheme(getColorTheme())
    setTheme(getColorTheme())
  }, [])

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="group/toggle size-8 rounded-md"
      aria-label="Toggle theme"
      onClick={() => setTheme(toggleColorTheme())}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4.5"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
        <path d="M12 3l0 18" />
        <path d="M12 9l4.65 -4.65" />
        <path d="M12 14.3l7.37 -7.37" />
        <path d="M12 19.6l8.85 -8.85" />
      </svg>
      <span className="sr-only">
        {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      </span>
    </Button>
  )
}
