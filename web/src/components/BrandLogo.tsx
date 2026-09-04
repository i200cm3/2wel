import { cn } from '@/lib/utils'

type BrandLogoProps = {
  className?: string
  /** Visual height in rem-ish tailwind size; width follows aspect ratio. */
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASS = {
  sm: 'h-16 w-auto',
  md: 'h-18 w-auto md:h-16',
  lg: 'h-20 w-auto md:h-16',
} as const

export function BrandLogo({ className, size = 'md' }: BrandLogoProps) {
  return (
    <img
      src="/logo.png"
      alt="2wel"
      width={512}
      height={289}
      decoding="async"
      className={cn('block shrink-0 object-contain object-left', SIZE_CLASS[size], className)}
    />
  )
}
