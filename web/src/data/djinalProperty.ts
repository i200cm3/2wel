import type { EndButton, MotionPreset, PropertyConfig, StoryClip } from '../types/story'
import {
  DEFAULT_EASING,
  DEFAULT_MENU_ID,
  DEFAULT_MENU_LINKS,
  DEFAULT_THEME,
  newEndButtonId,
  pathFromPreset,
} from '../types/story'

const DJINAL_MEDIA_PREFIX = '/media/projects/djinal/library/gallery'

function clips(
  folder: string,
  count: number,
  motions: Exclude<MotionPreset, 'custom'>[],
  totalSec: number,
): StoryClip[] {
  const per = Math.round((totalSec / count) * 10) / 10
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    const motion = motions[i % motions.length]
    const path = pathFromPreset(motion)
    return {
      id: `${folder}-${n}`,
      src: `${DJINAL_MEDIA_PREFIX}/${folder}/${n}.jpg`,
      motion,
      durationSec: per,
      from: path.from,
      to: path.to,
      easing: DEFAULT_EASING,
    }
  })
}

function menuButtons(items: { label: string; sequenceId: string }[]): EndButton[] {
  return items.map((item) => ({
    id: newEndButtonId(),
    label: item.label,
    target: { kind: 'sequence', sequenceId: item.sequenceId },
  }))
}

function backToMenuButtons(): EndButton[] {
  return [
    { id: newEndButtonId(), label: 'В меню', target: { kind: 'menu' } },
    { id: newEndButtonId(), label: 'Связаться в WhatsApp', target: { kind: 'contact' } },
  ]
}

const TOPIC_BUTTONS = [
  { label: 'О санатории', sequenceId: 'about' },
  { label: 'Размещение', sequenceId: 'rooms' },
  { label: 'Лечение', sequenceId: 'treatment' },
  { label: 'Досуг', sequenceId: 'leisure' },
  { label: 'Развлечения', sequenceId: 'fun' },
]

const MENU_BRANCHES = [
  { id: 'about', label: 'О санатории', sequenceId: 'about' },
  { id: 'rooms', label: 'Размещение', sequenceId: 'rooms' },
  { id: 'treatment', label: 'Лечение', sequenceId: 'treatment' },
  { id: 'leisure', label: 'Досуг', sequenceId: 'leisure' },
  { id: 'fun', label: 'Развлечения', sequenceId: 'fun' },
]

export const DJINAL_PROPERTY: PropertyConfig = {
  id: 'djinal',
  brand: {
    name: 'Джинал',
    fullName: 'Санаторий «Джинал»',
    city: 'Кисловодск',
    address: 'ул. Пятигорская, 4',
    phoneDisplay: '8 800 500-6775',
    phoneTel: '+78005006775',
    site: 'https://www.djinal.ru/',
    whatsAppNumber: '',
  },
  defaultGuestName: 'Иван',
  greetingSubtitle: 'Рады видеть вас среди гостей',
  theme: { ...DEFAULT_THEME },
  menuLinks: DEFAULT_MENU_LINKS.map((link) => ({ ...link })),
  defaultMenuId: DEFAULT_MENU_ID,
  menus: {
    [DEFAULT_MENU_ID]: {
      id: DEFAULT_MENU_ID,
      label: 'Главное меню',
      branches: MENU_BRANCHES.map((b) => ({ ...b })),
      menuLinks: DEFAULT_MENU_LINKS.map((link) => ({ ...link })),
      menuTtsFirstOnly: true,
    },
  },
  flow: ['intro', 'greeting'],
  branches: MENU_BRANCHES.map((b) => ({ ...b })),
  mediaLibrary: [
    { folder: 'intro', count: 6 },
    { folder: 'about', count: 6 },
    { folder: 'rooms', count: 8 },
    { folder: 'treatment', count: 8 },
    { folder: 'leisure', count: 8 },
    { folder: 'fun', count: 8 },
    { folder: 'park', count: 8 },
  ],
  sequences: {
    intro: {
      id: 'intro',
      label: 'Intro',
      title: 'Санаторий «Джинал»',
      subtitle: 'Кисловодск',
      clips: clips('intro', 6, ['zoom-out', 'pan-left', 'zoom-in'], 8),
    },
    greeting: {
      id: 'greeting',
      label: 'Приветствие',
      title: 'Здравствуйте, {name}!',
      subtitle: 'Рады видеть вас среди гостей',
      clips: [
        ...clips('intro', 2, ['zoom-in', 'pan-up'], 3.5),
        ...clips('about', 2, ['zoom-in', 'pan-up'], 3.5).map((c, i) => ({
          ...c,
          id: `greeting-about-${i + 1}`,
        })),
      ],
      endButtons: [
        ...menuButtons(TOPIC_BUTTONS),
        { id: newEndButtonId(), label: 'Связаться в WhatsApp', target: { kind: 'contact' } },
      ],
    },
    about: {
      id: 'about',
      label: 'О санатории',
      title: '{name}, расскажу о санатории',
      lines: [
        'Город-курорт Кисловодск, у подножия Джинальского хребта',
        'Профиль — общее оздоровление организма',
        'Наша гордость — лечение и забота о каждом госте',
        'Рядом — знаменитый курортный парк Кисловодска',
      ],
      clips: [
        ...clips('about', 6, ['pan-up', 'zoom-out', 'pan-right', 'pan-left', 'zoom-in'], 16),
        ...clips('park', 4, ['pan-left', 'zoom-out', 'pan-up', 'zoom-in'], 10).map((c, i) => ({
          ...c,
          id: `about-park-${i + 1}`,
        })),
      ],
      endButtons: backToMenuButtons(),
    },
    rooms: {
      id: 'rooms',
      label: 'Размещение',
      title: '{name}, расскажу о размещении',
      lines: [
        'Номерной фонд «Джинала» — 280 мест, категория 3★',
        'От уютных стандартов до апартаментов с кухней',
        'Wi‑Fi, ТВ, кондиционер — всё для спокойного отдыха',
      ],
      clips: clips('rooms', 8, ['zoom-out', 'pan-right', 'zoom-in', 'pan-left'], 28),
      endButtons: backToMenuButtons(),
    },
    treatment: {
      id: 'treatment',
      label: 'Лечение',
      title: '{name}, расскажу, как начинается лечение в санатории',
      lines: [
        'Профиль санатория — общее оздоровление',
        'Диагностика, процедуры и лечебные программы',
        'Врачи и кабинеты — рядом, в одном комплексе',
      ],
      clips: clips('treatment', 8, ['pan-up', 'zoom-in', 'pan-left', 'zoom-out'], 28),
      endButtons: backToMenuButtons(),
    },
    leisure: {
      id: 'leisure',
      label: 'Досуг',
      title: '{name}, расскажу о досуге',
      lines: [
        'Библиотека, чаепитие, тихие зоны отдыха',
        'Прогулки по территории и рядом с курортным парком',
        'Время для себя — без спешки и суеты',
      ],
      clips: clips('leisure', 8, ['pan-left', 'pan-up', 'zoom-out', 'pan-right'], 26),
      endButtons: backToMenuButtons(),
    },
    fun: {
      id: 'fun',
      label: 'Развлечения',
      title: '{name}, расскажу о развлечениях',
      lines: [
        'Бильярд, спорт, летнее кафе',
        'Площадки для детей и семейного отдыха',
        'Праздники и тёплое общение в кругу гостей',
      ],
      clips: clips('fun', 8, ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'], 26),
      endButtons: backToMenuButtons(),
    },
  },
}
