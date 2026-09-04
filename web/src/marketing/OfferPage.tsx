import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { BrandLogo } from '@/components/BrandLogo'
import { cn, SUPPORT_EMAIL, supportMailHref } from '@/lib/utils'
import { formatPriceFrom, PLAN_TIERS } from '@/lib/plans'
import { GuestPhone, type GuestScreenId } from './GuestPhone'
import './landing.css'

const CONTACT_EMAIL = SUPPORT_EMAIL
const MAIL_HREF = supportMailHref('2wel для объекта размещения')

type PlanUrl = {
  prefix?: string
  highlight: string
  suffix: string
  hint: string
}

const SUBDOMAIN_URL: PlanUrl = {
  highlight: 'ваш-санаторий',
  suffix: '.2wel.ru/ссылка',
  hint: 'Имя объекта — ваше, адрес остаётся на 2wel.ru',
}

const CUSTOM_DOMAIN_URL: PlanUrl = {
  prefix: 'promo.',
  highlight: 'ваш-сайт.ru',
  suffix: '/ссылка',
  hint: 'Гость видит ваш домен, не 2wel.ru',
}

const PLANS = PLAN_TIERS.map((tier) => ({
  ...tier,
  priceLabel: formatPriceFrom(tier.price),
  featured: tier.id === 'pro',
  items: tier.features,
}))

const CHANNELS = ['Письма', 'PDF', 'Сообщения', 'Звонки', 'Памятки', 'WhatsApp', 'Страницы сайта']

const JOURNEY: {
  id: string
  phase: string
  line: string
  text: string
  screen: GuestScreenId
}[] = [
  {
    id: 'before',
    phase: 'До заезда',
    line: 'Мы ждём вас',
    text: 'Гость открывает свою страницу: приветствие, размещение, лечение, питание и досуг — ещё до приезда.',
    screen: 'greeting',
  },
  {
    id: 'stay',
    phase: 'Проживание',
    line: 'Всё важное — в одном месте',
    text: 'Та же страница остаётся под рукой. Гость возвращается к темам и пишет, если что-то непонятно — без поиска писем и распечаток.',
    screen: 'menu',
  },
  {
    id: 'feedback',
    phase: 'Обратная связь',
    line: 'Как вам?',
    text: 'Со своей страницы гость пишет или звонит туда, куда вы указали. Вопрос приходит персоналу сразу — не после выезда.',
    screen: 'feedback',
  },
  {
    id: 'staff',
    phase: 'Реакция персонала',
    line: 'Мы уже в курсе',
    text: 'Сообщение не теряется. Персонал видит сигнал, пока гость ещё на территории, и отвечает.',
    screen: 'staff',
  },
  {
    id: 'after',
    phase: 'После проживания',
    line: 'Спасибо, что были с нами',
    text: 'Канал не обрывается на стойке. Можно поблагодарить, спросить как прошло и пригласить снова.',
    screen: 'after',
  },
]

const BUSINESS = [
  {
    title: 'Меньше одних и тех же вопросов',
    text: 'Гость заранее видит, как добраться, что взять и как устроен день. Стойка меньше повторяет одно и то же.',
  },
  {
    title: 'Ровный сервис, а не «кто успел»',
    text: 'Не разрозненные сообщения от разных сотрудников, а один персональный канал на каждый заезд.',
  },
  {
    title: 'Быстрее реакция на месте',
    text: 'Гость пишет или звонит со своей страницы. Сигнал приходит объекту, пока человек ещё у вас.',
  },
  {
    title: 'Понятно, что сработало',
    text: 'В кабинете видно, кто открыл страницу, кто досмотрел и кто написал. Не догадки — факты по заездам.',
  },
  {
    title: 'Ответ именно этому гостю',
    text: 'Не общая ссылка «для всех». После разговора можно показать то, что важно именно этому человеку — и закрыть его сомнения.',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Берём разговор',
    text: 'После звонка с гостем система получает запись из CRM и разбирает диалог — без ручной расшифровки.',
  },
  {
    n: '02',
    title: 'Желания и сомнения',
    text: 'Выделяем, что важно гостю и что его смущает: даты, состав, лечение, сравнение с другими — то, о чём говорили.',
  },
  {
    n: '03',
    title: 'Персональная презентация',
    text: 'Собираем короткую страницу под этот запрос. Гость смотрит и может сразу написать или позвонить вам со своей страницы.',
  },
] as const

const INCLUDED = [
  'Старт — персональная страница по готовому сценарию',
  'Про — презентация, собранная по разговору с гостем',
  'Число гостей не ограничено: платите за тариф, не за каждую ссылку',
  'Повышение тарифа включается сразу, понижение — с конца периода',
] as const

const NAV = [
  { href: '#product', label: 'Продукт' },
  { href: '#business', label: 'Для бизнеса' },
  { href: '#how', label: 'Как это работает' },
  { href: '#plans', label: 'Тарифы' },
] as const

function PlanUrlExample({ url, className }: { url: PlanUrl; className?: string }) {
  return (
    <p className={cn('mt-4 rounded-md border border-border bg-muted/60 px-3 py-2', className)}>
      <span className="block font-mono text-xs leading-relaxed">
        {url.prefix}
        <span className="text-foreground underline decoration-foreground/30 decoration-dotted underline-offset-4">
          {url.highlight}
        </span>
        <span className="text-muted-foreground">{url.suffix}</span>
      </span>
      <span className="text-muted-foreground mt-1.5 block text-[11px] leading-snug">{url.hint}</span>
    </p>
  )
}

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOn(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setOn(true)
          io.disconnect()
        }
      },
      { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn('landing-reveal', on && 'is-in', className)}
      style={{ transitionDelay: on ? `${delay}ms` : undefined }}
    >
      {children}
    </div>
  )
}

export function OfferPage() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [journey, setJourney] = useState(0)
  const themeColor = useRef<string | null>(null)

  useEffect(() => {
    const prev = document.title
    const meta = document.querySelector('meta[name="theme-color"]')
    themeColor.current = meta?.getAttribute('content') ?? null
    document.title = '2wel — персональный канал общения с гостем'
    meta?.setAttribute('content', '#fcfaf8')
    document.documentElement.classList.add('landing-open')
    return () => {
      document.title = prev
      if (meta) meta.setAttribute('content', themeColor.current ?? '#000000')
      document.documentElement.classList.remove('landing-open')
    }
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const step = JOURNEY[journey] ?? JOURNEY[0]

  return (
    <div className="landing text-foreground min-h-svh bg-background">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:px-3 focus:py-2"
      >
        К содержанию
      </a>

      <header className={cn('landing-header', scrolled && 'is-scrolled')}>
        <div className="landing-shell flex h-16 items-center justify-between gap-4 md:h-[4.25rem] pt-10">
          <a href="#top" className="landing-logo" aria-label="2wel">
            <BrandLogo size="sm" />
          </a>
          <nav className="landing-nav hidden items-center gap-6 md:flex" aria-label="Разделы">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Link to="/login" className="landing-btn landing-btn-ghost landing-btn-sm">
              Войти
            </Link>
            <a className="landing-btn landing-btn-primary landing-btn-sm" href={MAIL_HREF}>
              Обсудить 2wel
            </a>
          </div>
          <button
            type="button"
            className="text-foreground flex size-11 items-center justify-center rounded-md md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="sr-only">{menuOpen ? 'Закрыть меню' : 'Открыть меню'}</span>
            <span aria-hidden className="flex w-6 flex-col gap-1.5">
              <span
                className={cn(
                  'bg-foreground block h-0.5 w-full rounded-full transition',
                  menuOpen && 'translate-y-[7px] rotate-45',
                )}
              />
              <span
                className={cn(
                  'bg-foreground block h-0.5 w-full rounded-full transition',
                  menuOpen && '-translate-y-[7px] -rotate-45',
                )}
              />
            </span>
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div id="mobile-nav" className="landing-drawer md:hidden">
          <div className="flex h-16 items-center justify-between">
            <span className="landing-logo">
              <BrandLogo size="sm" />
            </span>
            <button
              type="button"
              className="text-foreground flex size-12 items-center justify-center rounded-md"
              onClick={() => setMenuOpen(false)}
            >
              <span className="sr-only">Закрыть</span>
              <X className="size-7" strokeWidth={2.25} aria-hidden />
            </button>
          </div>
          <nav className="mt-6 flex flex-col gap-1" aria-label="Мобильная навигация">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="font-heading py-3 text-2xl"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-8 flex flex-col gap-3">
            <Link to="/login" className="landing-btn landing-btn-ghost" onClick={() => setMenuOpen(false)}>
              Войти
            </Link>
            <a className="landing-btn landing-btn-primary" href={MAIL_HREF}>
              Обсудить 2wel
            </a>
          </div>
        </div>
      ) : null}

      <main id="main">
        <section id="top" className="landing-shell grid items-start gap-12 pt-10 pb-16 md:gap-16 md:pt-16 md:pb-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-20">
          <Reveal>
            <p className="landing-eyebrow">Для санаториев, отелей и спа</p>
            <h1 className="landing-display mt-5">
              Гость ещё не приехал.
              <br />
              Общение уже началось.
            </h1>
            <p className="landing-lead pt-6 max-w-xl">
              2wel даёт каждому гостю свою страницу: с именем, фотографиями объекта и возможностью
              ответить. А после звонка можно собрать презентацию под то, о чём говорили.
            </p>
            <div className="landing-cta-row mt-8 flex flex-wrap items-center gap-3">
              <a className="landing-btn landing-btn-primary" href={MAIL_HREF}>
                Обсудить 2wel
                <ArrowRight size={16} />
              </a>
              <a className="landing-btn landing-btn-ghost" href="#product">
                Посмотреть 2wel в работе
              </a>
            </div>
          </Reveal>
          <Reveal className="flex justify-center lg:justify-end" delay={120}>
            <GuestPhone />
          </Reveal>
        </section>

        <section className="border-y border-border bg-elevated">
          <div className="landing-shell grid gap-10 py-16 md:grid-cols-2 md:items-start md:gap-16 md:py-16">
            <Reveal>
              <p className="landing-eyebrow">Проблема</p>
              <h2 className="landing-h2 mt-4">Гость получает много информации. И мало ощущения, что о нём позаботились.</h2>
            </Reveal>
            <Reveal delay={80}>
              <p className="landing-lead max-w-lg">
                Письма, PDF, сообщения, звонки, памятки, чаты и страницы сайта живут отдельно. Каждое сообщение верное.
                Вместе они не складываются в один спокойный разговор.
              </p>
              <ul className="mt-8 flex flex-wrap gap-2">
                {CHANNELS.map((item) => (
                  <li
                    key={item}
                    className="text-muted-foreground rounded-full border border-border px-3 py-1 text-sm"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <div className="h-8" aria-hidden />
              <p className="landing-lead max-w-lg text-foreground">
                2wel собирает это в одну персональную страницу — с именем гостя, фотографиями объекта и возможностью
                ответить.
              </p>
            </Reveal>
          </div>
        </section>

        <section id="product" className="landing-shell pt-16 md:pt-16">
          <Reveal>
            <p className="landing-eyebrow">Путь гостя</p>
            <h2 className="landing-h2 mt-4">Один канал — от первого приветствия до возвращения</h2>
          </Reveal>
          <div className="mt-12 grid items-start gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
            <Reveal className="flex flex-col items-center lg:sticky lg:top-28">
              <div className="landing-journey-chips mb-5 flex w-full max-w-[19.5rem] gap-1.5 overflow-x-auto pb-1 lg:hidden">
                {JOURNEY.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn('landing-chip', i === journey && 'is-active')}
                    onClick={() => setJourney(i)}
                  >
                    {item.phase}
                  </button>
                ))}
              </div>
              <GuestPhone autoplay={false} initial={step.screen} />
             
              
            </Reveal>
            <div className="hidden lg:block">
              {JOURNEY.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn('landing-journey-btn', i === journey && 'is-active')}
                  aria-pressed={i === journey}
                  onClick={() => setJourney(i)}
                >
                  <span className="text-bronze pt-1 font-mono text-[11px] tracking-[0.14em] uppercase">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <span className="text-muted-foreground block text-sm">{item.phase}</span>
                    <span className="font-heading mt-1 block text-xl md:text-[1.35rem]">{item.line}</span>
                    {i === journey ? <span className="landing-body mt-2 block">{item.text}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-shell py-16 md:py-16">
          <Reveal>
            <p className="landing-eyebrow">Обратная связь</p>
            <h2 className="landing-h2 mt-4">2wel не только говорит гостю. Он даёт гостю ответить.</h2>
            <p className="landing-lead pt-5 max-w-2xl">
              На странице можно спросить, как проходит отдых, и сразу связаться с объектом — написать или позвонить
              по каналу, который вы указали. Сообщение или звонок приходят персоналу. Проблема решается, пока гость
              ещё здесь.
            </p>
          </Reveal>
          <ol className="landing-cycle mt-12">
            {[
              { n: '01', t: 'Сообщить', d: 'Гость пишет или звонит со своей страницы.' },
              { n: '02', t: 'Получить', d: 'Сигнал приходит объекту по выбранному каналу.' },
              { n: '03', t: 'Реагировать', d: 'Персонал видит сигнал вовремя.' },
              { n: '04', t: 'Решить', d: 'Гость получает ответ. Цикл замыкается.' },
            ].map((item, i) => (
              <li key={item.n} className="landing-cycle-step">
                {i > 0 ? <span className="landing-cycle-rule" aria-hidden /> : null}
                <p className="text-bronze font-mono text-[11px] tracking-[0.16em]">{item.n}</p>
                <h3 className="landing-h3 mt-3">{item.t}</h3>
                <p className="landing-body mt-2">{item.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="business" className="border-y border-border bg-elevated">
          <div className="landing-shell py-16 md:py-16">
            <Reveal>
              <p className="landing-eyebrow">Для руководителя</p>
              <h2 className="landing-h2 mt-4">Не только красиво для гостя. Спокойнее для объекта.</h2>
            </Reveal>
            <div className="mt-14 grid gap-x-16 gap-y-12 md:grid-cols-2">
              {BUSINESS.map((item, i) => (
                <Reveal key={item.title} delay={i * 40}>
                  <h3 className="landing-h3">{item.title}</h3>
                  <p className="landing-body mt-3 max-w-md">{item.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="landing-shell py-16 md:py-16">
          <Reveal>
            <p className="landing-eyebrow">Как это работает</p>
            <h2 className="landing-h2 mt-4">После звонка — презентация именно этому гостю</h2>
            <p className="landing-lead pt-4 max-w-2xl">
              Не общая ссылка «для всех». Берём разговор, понимаем, что важно гостю и что его
              смущает, — и собираем короткую презентацию под этот запрос.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-12">
            {STEPS.map((item, i) => (
              <Reveal key={item.n} delay={i * 70}>
                <p className="text-bronze font-mono text-[11px] tracking-[0.16em]">{item.n}</p>
                <h3 className="landing-h3 mt-4">{item.title}</h3>
                <p className="landing-body mt-3">{item.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="plans" className="border-t border-border">
          <div className="landing-shell py-16 md:py-16">
            <Reveal>
              <p className="landing-eyebrow">Тарифы</p>
              <h2 className="landing-h2 mt-4">Два способа ответить гостю</h2>
              <p className="landing-lead pt-4 max-w-xl">
                Старт — страница по готовому сценарию. Про — презентация, собранная после разговора
                с гостем. Число гостей не ограничено.
              </p>
            </Reveal>
            <div className="mt-12 grid gap-4 md:grid-cols-2 md:gap-6">
              {PLANS.map((plan) => (
                <article
                  key={plan.id}
                  className={cn(
                    'flex flex-col rounded-xl border bg-card p-6 sm:p-7',
                    plan.featured ? 'border-primary shadow-[0_1px_0_var(--primary)]' : 'border-border',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-heading text-xl font-semibold">{plan.name}</h3>
                    {plan.featured ? <Badge>Рекомендуем</Badge> : null}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs tracking-wide uppercase">
                    {plan.tagline}
                  </p>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{plan.blurb}</p>
                  <p className="mt-6">
                    <span className="font-heading text-[2.35rem] leading-none font-semibold">
                      {plan.priceLabel}
                    </span>
                    <span className="text-muted-foreground ml-1.5 text-sm">₽ / мес</span>
                  </p>
                  <p className="text-muted-foreground mt-2 text-xs">Внедрение {plan.setup}</p>
                  <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                    {plan.items.map((item) => (
                      <li key={item} className="flex gap-2 text-sm leading-snug">
                        <Check className="text-primary mt-0.5 size-4 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    className={cn(
                      'landing-btn mt-6 w-full',
                      plan.featured ? 'landing-btn-primary' : 'landing-btn-ghost',
                    )}
                    href={MAIL_HREF}
                  >
                    Обсудить {plan.name}
                  </a>
                </article>
              ))}
            </div>

            <div className="mt-16 border-t border-border pt-14">
              <h2 className="landing-h2">Отдельные услуги</h2>
              <p className="landing-lead pt-4 max-w-xl">
                Адрес ссылки для гостя. В тарифе уже есть поддомен на 2wel.ru — свой домен
                подключается отдельно.
              </p>
              <article className="mt-10 rounded-xl border border-border bg-card p-6 sm:p-7">
                <div className="grid gap-8 sm:grid-cols-2 sm:items-stretch sm:gap-10">
                  <div className="flex h-full flex-col">
                    <p className="landing-eyebrow">По умолчанию</p>
                    <h3 className="font-heading mt-3 text-lg font-semibold">Поддомен на 2wel.ru</h3>
                    <p className="text-muted-foreground mt-1 text-xs">Входит в Старт и Про</p>
                    <PlanUrlExample url={SUBDOMAIN_URL} className="mt-auto pt-4" />
                  </div>
                  <div className="flex h-full flex-col">
                    <p className="landing-eyebrow">Дополнительно</p>
                    <h3 className="font-heading mt-3 text-lg font-semibold">Свой домен</h3>
                    <p className="font-heading mt-2 text-xl font-semibold">от 5 000 ₽ разово</p>
                    <p className="landing-body mt-3">
                      Гость видит ваш адрес, не 2wel.ru. Настройку DNS и сопровождение берём на себя.
                    </p>
                    <PlanUrlExample url={CUSTOM_DOMAIN_URL} className="mt-auto pt-4" />
                  </div>
                </div>
              </article>
            </div>

            <div className="mt-14 grid gap-10 border-t border-border pt-14 md:grid-cols-2 md:gap-16">
              <div>
                <h2 className="landing-h2">Как считать окупаемость</h2>
                <p className="landing-lead pt-4">
                  Один дополнительный заезд на 15–20 тыс. ₽ уже покрывает месяц тарифа «Про». Это
                  ответ гостю после разговора — не ролик, который показали раз в год.
                </p>
              </div>
              <ul className="flex flex-col gap-3">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
                    <Check className="text-primary mt-0.5 size-4 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground">
          <div className="landing-shell py-16 md:py-20">
            <h2 className="font-heading text-[clamp(1.8rem,3vw,2.6rem)] leading-[1.12] font-semibold tracking-[-0.03em]">
              Покажем на ваших фото
            </h2>
            <p className="mt-4 max-w-xl text-[1.05rem] leading-relaxed text-primary-foreground/75">
              Напишите название объекта и сколько гостей в месяц. Ответим с расчётом внедрения и
              примером персональной страницы.
            </p>
            <div className="landing-cta-row mt-8 flex flex-wrap items-center gap-3">
              <a className="landing-btn landing-btn-invert" href={MAIL_HREF}>
                {CONTACT_EMAIL}
              </a>
              <Link
                to="/login"
                className="landing-btn border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/10 border"
              >
                Войти в кабинет
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="landing-shell grid gap-10 py-12 md:grid-cols-[1.2fr_1fr_1fr] md:gap-16 md:py-16">
          <div>
            <p className="landing-logo">
              <BrandLogo size="md" />
            </p>
            <p className="landing-body mt-4 max-w-sm">
              Персональная страница для каждого гостя — до заезда, во время проживания и после.
            </p>
          </div>
          <div>
            <p className="landing-eyebrow">Навигация</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="text-muted-foreground hover:text-foreground">
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link to="/login" className="text-muted-foreground hover:text-foreground">
                  Войти
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="landing-eyebrow">Контакты</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm">
              <li>
                <a href={MAIL_HREF} className="text-muted-foreground hover:text-foreground">
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li>
                <a href="https://2wel.ru" className="text-muted-foreground hover:text-foreground">
                  2wel.ru
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="landing-shell text-muted-foreground border-t border-border py-6 text-xs">
          © {new Date().getFullYear()} 2wel
        </div>
      </footer>
    </div>
  )
}
