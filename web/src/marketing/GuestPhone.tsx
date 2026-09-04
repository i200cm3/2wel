import { useEffect, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type GuestScreenId =
  | 'greeting'
  | 'menu'
  | 'about'
  | 'rooms'
  | 'treatment'
  | 'leisure'
  | 'fun'
  | 'feedback'
  | 'staff'
  | 'after'

type StoryScreen = {
  id: GuestScreenId
  kind: 'story'
  image: string
  title: string
  lines?: string[]
  stars?: boolean
  badge?: string
}

const LANDING_V = '20260818b'
const landingPhoto = (file: string) => `/media/landing/${file}?v=${LANDING_V}`
const MENU_PHOTO = landingPhoto('lounge.jpg')

const MENU_TOPICS: { id: GuestScreenId; label: string }[] = [
  { id: 'about', label: 'О санатории' },
  { id: 'rooms', label: 'Размещение' },
  { id: 'treatment', label: 'Лечение' },
  { id: 'leisure', label: 'Досуг' },
  { id: 'fun', label: 'Питание' },
]

const STORIES: Record<Exclude<GuestScreenId, 'menu'>, StoryScreen> = {
  greeting: {
    id: 'greeting',
    kind: 'story',
    image: landingPhoto('arrive.jpg'),
    title: 'Александр, рады приветствовать вас',
    lines: ['Ваш персональный канал уже открыт'],
  },
  about: {
    id: 'about',
    kind: 'story',
    image: landingPhoto('arrive.jpg'),
    title: 'Александр, расскажу о пребывании',
    lines: ['Территория, маршрут, что важно знать заранее'],
  },
  rooms: {
    id: 'rooms',
    kind: 'story',
    image: landingPhoto('room.jpg'),
    title: 'Александр, расскажу о размещении',
    lines: ['Ваш номер и как в нём устроиться'],
  },
  treatment: {
    id: 'treatment',
    kind: 'story',
    image: landingPhoto('spa.jpg'),
    title: 'Александр, расскажу о лечении',
    lines: ['Процедуры и как к ним подготовиться'],
  },
  leisure: {
    id: 'leisure',
    kind: 'story',
    image: landingPhoto('leisure.jpg'),
    title: 'Александр, расскажу о досуге',
    lines: ['Тихие места и время для себя'],
  },
  fun: {
    id: 'fun',
    kind: 'story',
    image: landingPhoto('dining.jpg'),
    title: 'Александр, расскажу о питании',
    lines: ['Ресторан, часы и что стоит попробовать'],
  },
  feedback: {
    id: 'feedback',
    kind: 'story',
    image: landingPhoto('terrace.jpg'),
    title: 'Как проходит ваш отдых?',
    lines: ['Напишите нам — мы рядом'],
    stars: true,
  },
  staff: {
    id: 'staff',
    kind: 'story',
    image: landingPhoto('terrace.jpg'),
    title: 'Александр, мы получили ваше сообщение',
    lines: ['Администратор уже в курсе'],
    badge: 'Получено',
  },
  after: {
    id: 'after',
    kind: 'story',
    image: landingPhoto('farewell.jpg'),
    title: 'Спасибо, что были с нами',
    lines: ['Будем рады видеть вас снова'],
  },
}

const AUTOPLAY: GuestScreenId[] = ['menu', 'greeting', 'rooms', 'feedback', 'staff', 'after']

function StatusBar() {
  return (
    <>
      <div className="guest-device-island" aria-hidden />
      <div className="guest-device-status" aria-hidden>
        <span>9:41</span>
        <span className="guest-device-meters">
          <i />
          <i />
          <i />
          <b />
        </span>
      </div>
      <div className="guest-device-home" aria-hidden />
    </>
  )
}

function StoryView({ screen, eager = false }: { screen: StoryScreen; eager?: boolean }) {
  return (
    <div className="absolute inset-0">
      <img
        src={screen.image}
        alt=""
        className="guest-screen-photo"
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
      />
      <div className="guest-screen-veil" />
      <div className="guest-caption">
        {screen.badge ? <p className="guest-badge">{screen.badge}</p> : null}
        <h3>{screen.title}</h3>
        {screen.stars ? <p className="guest-stars">★★★★★</p> : null}
        {screen.lines?.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  )
}

function MenuView({ onSelect }: { onSelect: (id: GuestScreenId) => void }) {
  return (
    <div className="absolute inset-0">
      <div className="guest-menu-bg" style={{ '--menu-photo': `url(${MENU_PHOTO})` } as CSSProperties} />
      <div className="guest-menu-inner">
        <p className="guest-menu-kicker">Ваше пребывание</p>
        <h3>{'Александр, что вам\nинтересно узнать?'}</h3>
        <p className="guest-menu-hint">Выберите тему — можно смотреть по очереди</p>
        <div className="guest-menu-grid">
          {MENU_TOPICS.map((topic) => (
            <button
              key={topic.id}
              type="button"
              className="guest-menu-btn"
              onClick={() => onSelect(topic.id)}
            >
              {topic.label}
            </button>
          ))}
        </div>
        <button type="button" className="guest-menu-btn guest-menu-wa" onClick={() => onSelect('feedback')}>
          Связаться
        </button>
      </div>
    </div>
  )
}

function DeviceFrame({
  screen,
  onSelect,
  className,
}: {
  screen: GuestScreenId
  onSelect: (id: GuestScreenId) => void
  className?: string
}) {
  const storyIds = Object.keys(STORIES) as Exclude<GuestScreenId, 'menu'>[]
  return (
    <div className={cn('guest-device', className)}>
      <div className="guest-device-screen">
        <StatusBar />
        {storyIds.map((id) => (
          <div key={id} className={cn('guest-screen', screen === id && 'is-active')}>
            <StoryView screen={STORIES[id]} eager={id === 'greeting'} />
          </div>
        ))}
        <div className={cn('guest-screen', screen === 'menu' && 'is-active')}>
          <MenuView onSelect={onSelect} />
        </div>
      </div>
    </div>
  )
}

type Props = {
  className?: string
  autoplay?: boolean
  initial?: GuestScreenId
}

export function GuestPhone({ className, autoplay = true, initial = 'menu' }: Props) {
  const [screen, setScreen] = useState<GuestScreenId>(initial)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    setScreen(initial)
  }, [initial])

  useEffect(() => {
    if (!autoplay || paused) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const tick = window.setInterval(() => {
      setScreen((cur) => {
        const i = AUTOPLAY.indexOf(cur)
        return AUTOPLAY[(i + 1) % AUTOPLAY.length]
      })
    }, 2800)
    return () => window.clearInterval(tick)
  }, [autoplay, paused])

  const select = (id: GuestScreenId) => {
    setScreen(id)
    setPaused(true)
  }

  return (
    <div
      className={className}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => autoplay && setPaused(false)}
      role="region"
      aria-label="Интерфейс, который видит гость в 2wel"
    >
      <p className="sr-only" aria-live="polite">
        {screen === 'menu'
          ? 'Александр, что вам интересно узнать? Меню: о санатории, размещение, лечение, досуг, питание.'
          : STORIES[screen].title}
      </p>
      <DeviceFrame screen={screen} onSelect={select} />
    </div>
  )
}
