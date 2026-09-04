const STARTER_PREFIX = '/media/starter'

const MOTION = {
  none: {
    from: { x: 0.5, y: 0.5, scale: 1.02 },
    to: { x: 0.5, y: 0.5, scale: 1.02 },
  },
  'zoom-out': {
    from: { x: 0.5, y: 0.5, scale: 1.18 },
    to: { x: 0.5, y: 0.5, scale: 1.02 },
  },
  'zoom-in': {
    from: { x: 0.5, y: 0.5, scale: 1.02 },
    to: { x: 0.5, y: 0.5, scale: 1.18 },
  },
  'pan-left': {
    from: { x: 0.62, y: 0.5, scale: 1.14 },
    to: { x: 0.38, y: 0.5, scale: 1.14 },
  },
  'pan-right': {
    from: { x: 0.38, y: 0.5, scale: 1.14 },
    to: { x: 0.62, y: 0.5, scale: 1.14 },
  },
  'pan-up': {
    from: { x: 0.5, y: 0.62, scale: 1.14 },
    to: { x: 0.5, y: 0.38, scale: 1.14 },
  },
}

function clip(id, file, motion, durationSec, { showTitle = false, transition = 'dissolve' } = {}) {
  const path = MOTION[motion] ?? MOTION.none
  return {
    id,
    src: `${STARTER_PREFIX}/${file}`,
    media: 'image',
    motion,
    durationSec,
    animSec: durationSec,
    from: { ...path.from },
    to: { ...path.to },
    easing: 'ease-in-out',
    transition,
    showTitle,
  }
}

function cue(id, startSec, durationSec, text) {
  return { id, startSec, durationSec, text }
}

function backToMenu(sequenceId) {
  return [{ id: `btn-${sequenceId}-menu`, label: 'К разделам', target: { kind: 'menu' } }]
}

export const STARTER_MEDIA_PREFIX = STARTER_PREFIX

export function blankPresentationConfig({ id, name, musicSrc } = {}) {
  const label = String(name ?? '').trim() || 'Проект'
  const code = String(id ?? 'project').trim() || 'project'
  return {
    id: code,
    brand: {
      name: label,
      fullName: label,
      city: '',
      address: '',
      phoneDisplay: '',
      phoneTel: '',
      site: '',
      whatsAppNumber: '',
    },
    defaultGuestName: 'Гость',
    greetingSubtitle: 'Рады видеть вас',
    theme: {
      orientation: 'portrait',
      captionBarColor: '#0a100e',
      captionBarOpacity: 0.78,
      titleColor: '#e8dfd0',
      textColor: '#e8dfd0',
      titleFont: 'cormorant',
      textFont: 'nunito',
      titleFontSize: 26,
      textFontSize: 15,
      musicVolume: 0.22,
      ttsVolume: 1,
    },
    flow: ['intro'],
    defaultMenuId: 'main',
    menus: {
      main: {
        id: 'main',
        label: 'Главное меню',
        branches: [],
        menuLinks: [
          {
            id: 'menu-link-whatsapp',
            label: 'Связаться в WhatsApp',
            href: 'https://wa.me/{phone}?text=Здравствуйте! Меня зовут {name}.',
            bg: '#25d366',
            textColor: '#ffffff',
          },
        ],
        menuTtsFirstOnly: true,
      },
    },
    branches: [],
    mediaLibrary: [],
    musicSrc: musicSrc || '/media/music/ambient.mp3',
    sequences: {
      intro: {
        id: 'intro',
        label: 'Начало',
        title: label,
        clips: [],
      },
    },
  }
}

/** Пробная презентация вымышленного объекта — одна на все новые аккаунты.
 *  Синхронизировано с аккаунтом Тест (200cm3@gmail.com / test7), 2026-08-24.
 */
export function trialPresentationConfig({ id, musicSrc } = {}) {
  const code = String(id ?? 'project').trim() || 'project'
  return {
    id: code,
    brand: {
      city: "Телецкое озеро",
      name: "Сосновый берег",
      site: "",
      address: "с. Артыбаш, ул. Береговая, 7",
      fullName: "Спа-отель «Сосновый берег»",
      phoneTel: "+73854401280",
      phoneDisplay: "+7 385 440-12-80",
      whatsAppNumber: "",
    },
    defaultGuestName: "Гость",
    greetingSubtitle: "Рады видеть вас среди гостей",
    theme: {
      textFont: "nunito",
      textColor: "#efe4d4",
      titleFont: "playfair",
      ttsVolume: 1,
      titleColor: "#f2e6d4",
      musicVolume: 0.22,
      orientation: "portrait",
      textFontSize: 13,
      titleFontSize: 22,
      captionBarColor: "#16110c",
      captionBarOpacity: 0.72,
    },
    flow: [
      "intro",
      "greeting",
    ],
    defaultMenuId: "main",
    menus: {
      main: {
        id: "main",
        label: "Главное меню",
        branches: [
          {
            id: "rooms",
            label: "Номера",
            sequenceId: "rooms",
          },
          {
            id: "restaurant",
            label: "Ресторан",
            sequenceId: "restaurant",
          },
          {
            id: "spa",
            label: "СПА",
            sequenceId: "spa",
          },
          {
            id: "lake",
            label: "Озеро",
            sequenceId: "lake",
          },
        ],
        menuCopy: {
          showHint: true,
          showTitle: true,
          showKicker: false,
        },
        menuLinks: [
          {
            bg: "#5127e7",
            id: "link-kbusp0c",
            href: "https://max.ru/{max}",
            label: "Написать в MAX",
            textColor: "#ffffff",
          },
        ],
        menuTheme: {
          buttonBg: "#e8dfd0",
          buttonsW: 0.7592103794642857,
          buttonsX: 0.12794921874999998,
          buttonsY: 0.048312799183865655,
          textFont: "manrope",
          buttonGap: 10,
          contactBg: "#c4a574",
          textColor: "#e8dfd0",
          titleFont: "cormorant",
          buttonPadY: 8,
          buttonText: "#14201b",
          titleColor: "#e8dfd0",
          contactText: "#1a140c",
          kickerColor: "#c4a574",
          buttonRadius: 14,
          textFontSize: 14,
          titleFontSize: 36,
          buttonFontSize: 12,
          kickerFontSize: 11,
        },
        menuTtsFirstOnly: true,
      },
    },
    branches: [
      {
        id: "rooms",
        label: "Номера",
        sequenceId: "rooms",
      },
      {
        id: "restaurant",
        label: "Ресторан",
        sequenceId: "restaurant",
      },
      {
        id: "spa",
        label: "СПА",
        sequenceId: "spa",
      },
      {
        id: "lake",
        label: "Озеро",
        sequenceId: "lake",
      },
    ],
    mediaLibrary: [
      {
        folder: "starter",
        count: 17,
      },
    ],
    musicSrc: musicSrc || '/media/music/ambient.mp3',
    menuCopy: {
      showHint: true,
      showTitle: true,
      showKicker: false,
    },
    menuTheme: {
      buttonBg: "#e8dfd0",
      buttonsW: 0.7592103794642857,
      buttonsX: 0.12794921874999998,
      buttonsY: 0.048312799183865655,
      textFont: "manrope",
      buttonGap: 10,
      contactBg: "#c4a574",
      textColor: "#e8dfd0",
      titleFont: "cormorant",
      buttonPadY: 8,
      buttonText: "#14201b",
      titleColor: "#e8dfd0",
      contactText: "#1a140c",
      kickerColor: "#c4a574",
      buttonRadius: 14,
      textFontSize: 14,
      titleFontSize: 36,
      buttonFontSize: 12,
      kickerFontSize: 11,
    },
    menuLinks: [
      {
        bg: "#5127e7",
        id: "link-kbusp0c",
        href: "https://max.ru/{max}",
        label: "Написать в MAX",
        textColor: "#ffffff",
      },
    ],
    menuTtsFirstOnly: true,
    emailPreview: {
      enabled: false,
      showPlay: true,
      showTitle: true,
    },
    sequences: {
      spa: {
        id: "spa",
        cues: [
          {
            id: "cue-s1",
            text: "После дороги хорошо начать с бассейна и вида на горы.",
            ttsSrc: "/media/tts/starter/el_e9954aff81dc.mp3",
            ttsHash: "e9954aff81dcda1b164fc9dae569f34dea10ed37fb368809ba2899e57ff5860c",
            ttsText: "Вода и тишина. После дороги хорошо начать с бассейна и вида на горы.",
            startSec: 0,
            durationSec: 5.76,
          },
          {
            id: "cue-s2",
            text: "Массаж, сауна и тихие комнаты — без спешки и жёсткого расписания.",
            ttsSrc: "/media/tts/starter/el_506f3a2d7c25.mp3",
            ttsHash: "506f3a2d7c25b49b420c07cf25fc6f0d033051df81a0d263156640bddb297650",
            ttsText: "Массаж, сауна и тихие комнаты — без спешки и жёсткого расписания.",
            startSec: 5.76,
            durationSec: 5.6,
          },
          {
            id: "cue-s3",
            text: "Спа открыто весь день: можно заглянуть утром или поздно вечером.",
            ttsSrc: "/media/tts/starter/el_5564654159c6.mp3",
            ttsHash: "5564654159c679966b925072e1f78e178e2bb8b63030f1b8d7d0163b4c6a84c5",
            ttsText: "Спа открыто весь день: можно заглянуть утром или поздно вечером.",
            startSec: 11.36,
            durationSec: 4.88,
          },
        ],
        clips: [
          {
            id: "spa-01",
            to: {
              x: 0.38,
              y: 0.5,
              scale: 1.14,
            },
            src: "/media/starter/spa-01.jpg",
            from: {
              x: 0.62,
              y: 0.5,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "pan-left",
            animSec: 5.76,
            showTitle: true,
            transition: "dissolve",
            durationSec: 5.76,
          },
          {
            id: "spa-02",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            src: "/media/starter/spa-02.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-in",
            animSec: 5.6,
            showTitle: false,
            transition: "dissolve",
            durationSec: 5.6,
          },
          {
            id: "spa-03",
            to: {
              x: 0.62,
              y: 0.5,
              scale: 1.14,
            },
            src: "/media/starter/spa-03.jpg",
            from: {
              x: 0.38,
              y: 0.5,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "pan-right",
            animSec: 4.88,
            showTitle: false,
            transition: "dissolve",
            durationSec: 4.88,
          },
        ],
        label: "СПА",
        title: "Вода и тишина",
        endButtons: [
          {
            id: "btn-spa-menu",
            label: "К разделам",
            target: {
              kind: "menu",
            },
          },
        ],
      },
      lake: {
        id: "lake",
        cues: [
          {
            id: "cue-l1",
            text: "Телецкое озеро — в нескольких шагах от крыльца.",
            startSec: 0,
            durationSec: 4.6,
          },
          {
            id: "cue-l2",
            text: "Тропы среди кедров, пирс на рассвете, лодки у берега.",
            startSec: 4.6,
            durationSec: 4.7,
          },
          {
            id: "cue-l3",
            text: "Вечером — костёр на берегу и длинный закат над водой.",
            startSec: 9.3,
            durationSec: 4.5,
          },
          {
            id: "cue-l4",
            text: "Если захотите — подскажем, куда сходить и что взять с собой.",
            startSec: 13.8,
            durationSec: 5,
          },
        ],
        clips: [
          {
            id: "lake-01",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            src: "/media/starter/lake-01.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-out",
            animSec: 4.6,
            showTitle: true,
            transition: "dissolve",
            durationSec: 4.6,
          },
          {
            id: "lake-02",
            to: {
              x: 0.5,
              y: 0.38,
              scale: 1.14,
            },
            src: "/media/starter/lake-02.jpg",
            from: {
              x: 0.5,
              y: 0.62,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "pan-up",
            animSec: 4.7,
            showTitle: false,
            transition: "dissolve",
            durationSec: 4.7,
          },
          {
            id: "lake-03",
            to: {
              x: 0.38,
              y: 0.5,
              scale: 1.14,
            },
            src: "/media/starter/lake-03.jpg",
            from: {
              x: 0.62,
              y: 0.5,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "pan-left",
            animSec: 4.5,
            showTitle: false,
            transition: "dissolve",
            durationSec: 4.5,
          },
          {
            id: "lake-04",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            src: "/media/starter/lake-04.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-in",
            animSec: 5,
            showTitle: false,
            transition: "dissolve",
            durationSec: 5,
          },
        ],
        label: "Озеро",
        title: "Берег рядом",
        endButtons: [
          {
            id: "btn-lake-menu",
            label: "К разделам",
            target: {
              kind: "menu",
            },
          },
        ],
      },
      intro: {
        id: "intro",
        cues: [],
        clips: [
          {
            id: "intro-01",
            to: {
              x: 0.38,
              y: 0.5,
              scale: 1.14,
            },
            src: "/media/starter/intro-01.jpg",
            from: {
              x: 0.62,
              y: 0.5,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "pan-left",
            animSec: 4,
            showTitle: false,
            transition: "cut",
            durationSec: 4,
          },
        ],
        label: "Intro",
        title: "",
      },
      rooms: {
        id: "rooms",
        cues: [
          {
            id: "cue-r1",
            text: "Ваш номер — тихое место с видом на воду и лес.",
            ttsSrc: "/media/tts/starter/el_69ac313301a9.mp3",
            ttsHash: "69ac313301a970bcd33fcf959769e479417abafd3026c38ccd9033898751a228",
            ttsText: "Ваш номер.Ваш номер — тихое место с видом на воду и лес.",
            startSec: 0,
            durationSec: 5.28,
          },
          {
            id: "cue-r2",
            text: "Утром свет с озера, вечером — тёплый свет ламп и тишина.",
            ttsSrc: "/media/tts/starter/el_c35d11a3a612.mp3",
            ttsHash: "c35d11a3a61223727f14b270758f3c720ab39f40ce4355b6b43e354f850bc916",
            ttsText: "Утром свет с озера, вечером — тёплый свет ламп и тишина.",
            startSec: 5.28,
            durationSec: 4.16,
          },
          {
            id: "cue-r3",
            text: "Можно остаться в номере или выйти на балкон к соснам.",
            ttsSrc: "/media/tts/starter/el_40a99b3ad437.mp3",
            ttsHash: "40a99b3ad4371e1e5edecc6b8af7e1afb08b1f65a6b829aeeefe03829a5979fa",
            ttsText: "Можно остаться в номере или выйти на балкон к соснам.",
            startSec: 9.44,
            durationSec: 3.44,
          },
        ],
        clips: [
          {
            id: "rooms-01",
            to: {
              x: 0.62,
              y: 0.5,
              scale: 1.14,
            },
            src: "/media/starter/rooms-01.jpg",
            from: {
              x: 0.38,
              y: 0.5,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "pan-right",
            animSec: 5.28,
            showTitle: true,
            transition: "dissolve",
            durationSec: 5.28,
          },
          {
            id: "rooms-02",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            src: "/media/starter/rooms-02.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-in",
            animSec: 4.16,
            showTitle: false,
            transition: "dissolve",
            durationSec: 4.16,
          },
          {
            id: "rooms-03",
            to: {
              x: 0.38,
              y: 0.5,
              scale: 1.14,
            },
            src: "/media/starter/rooms-03.jpg",
            from: {
              x: 0.62,
              y: 0.5,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "pan-left",
            animSec: 3.44,
            showTitle: false,
            transition: "dissolve",
            durationSec: 3.44,
          },
        ],
        label: "Номера",
        title: "Ваш номер",
        endButtons: [
          {
            id: "btn-rooms-menu",
            label: "К разделам",
            target: {
              kind: "menu",
            },
          },
        ],
      },
      greeting: {
        id: "greeting",
        cues: [
          {
            id: "cue-g1",
            text: "Совсем скоро вы будете гостем спа-отеля «Сосновый берег».",
            ttsSrc: "/media/tts/starter/el_790e15111f82.mp3",
            ttsHash: "790e15111f8247f903ed54002c492f181d464046a2bb2ab74f5aac1defe88de6",
            ttsText: "Здравствуйте, {name}!.Совсем скоро вы будете гостем спа-отеля «Сосновый берег».",
            startSec: 0,
            durationSec: 5.52,
          },
          {
            id: "cue-g2",
            text: "На берегу Телецкого озера, среди кедров — тихое место, куда приезжают выдохнуть.",
            ttsSrc: "/media/tts/starter/el_23071d57a398.mp3",
            ttsHash: "23071d57a398b20d861cf1b71bb9b30da1bb3ada19ce5552d66d0288b31d4e2d",
            ttsText: "На берегу Телецкого озера, среди кедров — тихое место, куда приезжают выдохнуть.",
            startSec: 5.52,
            durationSec: 5.76,
          },
          {
            id: "cue-g3",
            text: "Расскажем про номера, кухню, спа и прогулки. Выберите раздел — или просто смотрите дальше.",
            ttsSrc: "/media/tts/starter/el_ca7f870a24ee.mp3",
            ttsHash: "ca7f870a24ee7cd8cb65a83117b5c4f5b7199dc6f42888ccf56e6c55e442785d",
            ttsText: "Расскажем про номера, кухню, спа и прогулки. Выберите раздел — или просто смотрите дальше.",
            startSec: 11.28,
            durationSec: 6.24,
          },
        ],
        clips: [
          {
            id: "greeting-01",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            src: "/media/starter/greeting-01.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-in",
            animSec: 5.52,
            showTitle: true,
            transition: "dissolve",
            durationSec: 5.52,
          },
          {
            id: "greeting-02",
            to: {
              x: 0.5,
              y: 0.4386,
              scale: 1.14,
            },
            src: "/media/starter/greeting-02.jpg",
            from: {
              x: 0.5,
              y: 0.5614,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "custom",
            animSec: 5.76,
            showTitle: false,
            transition: "dissolve",
            durationSec: 5.76,
          },
          {
            id: "greeting-03",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            src: "/media/starter/greeting-03.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-out",
            animSec: 6.24,
            showTitle: false,
            transition: "dissolve",
            durationSec: 6.24,
          },
        ],
        label: "Приветствие",
        title: "Здравствуйте, {name}!",
        endButtons: [
          {
            id: "btn-rooms",
            label: "Номера",
            target: {
              kind: "sequence",
              sequenceId: "rooms",
            },
          },
          {
            id: "btn-restaurant",
            label: "Ресторан",
            target: {
              kind: "sequence",
              sequenceId: "restaurant",
            },
          },
          {
            id: "btn-spa",
            label: "СПА",
            target: {
              kind: "sequence",
              sequenceId: "spa",
            },
          },
          {
            id: "btn-lake",
            label: "Озеро",
            target: {
              kind: "sequence",
              sequenceId: "lake",
            },
          },
          {
            id: "btn-contact",
            label: "Написать нам",
            target: {
              kind: "contact",
            },
          },
        ],
      },
      restaurant: {
        id: "restaurant",
        cues: [
          {
            id: "cue-f1",
            text: "Завтрак и ужин — в ресторане с панорамными окнами на озеро.",
            ttsSrc: "/media/tts/starter/el_c35271372657.mp3",
            ttsHash: "c35271372657b312a5fd495a954b3e95eb0d5917082359195b335cf54ff1e6c8",
            ttsText: "Кухня у озера.Завтрак и ужин — в ресторане с панорамными окнами на озеро.",
            startSec: 0,
            durationSec: 6.24,
          },
          {
            id: "cue-f2",
            text: "Готовим из того, что рядом: рыба, ягоды, травы и хлеб с утра.",
            ttsSrc: "/media/tts/starter/el_8b4a621c67df.mp3",
            ttsHash: "8b4a621c67dfe511e6c174a0d6c5390100a881b38c4c76376d805ed36fefb3ea",
            ttsText: "Готовим из того, что рядом: рыба, ягоды, травы и хлеб с утра.",
            startSec: 6.24,
            durationSec: 4.88,
          },
          {
            id: "cue-f3",
            text: "Можно попросить стол у окна или тихий угол у камина.",
            ttsSrc: "/media/tts/starter/el_5d70c94872aa.mp3",
            ttsHash: "5d70c94872aafea357e2a01daae45a4cceb7de41b9bb2120ce46c26bf976726a",
            ttsText: "Можно попросить стол у окна или тихий угол у камина.",
            startSec: 11.12,
            durationSec: 4.16,
          },
        ],
        clips: [
          {
            id: "food-01",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            src: "/media/starter/food-01.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-out",
            animSec: 6.24,
            showTitle: true,
            transition: "dissolve",
            durationSec: 6.24,
          },
          {
            id: "food-02",
            to: {
              x: 0.5,
              y: 0.4386,
              scale: 1.14,
            },
            src: "/media/starter/food-02.jpg",
            from: {
              x: 0.5,
              y: 0.5614,
              scale: 1.14,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "custom",
            animSec: 4.88,
            showTitle: false,
            transition: "dissolve",
            durationSec: 4.88,
          },
          {
            id: "food-03",
            to: {
              x: 0.5,
              y: 0.5,
              scale: 1.18,
            },
            src: "/media/starter/food-03.jpg",
            from: {
              x: 0.5,
              y: 0.5,
              scale: 1.02,
            },
            media: "image",
            easing: "ease-in-out",
            motion: "zoom-in",
            animSec: 4.16,
            showTitle: false,
            transition: "dissolve",
            durationSec: 4.16,
          },
        ],
        label: "Ресторан",
        title: "Кухня у озера",
        endButtons: [
          {
            id: "btn-restaurant-menu",
            label: "К разделам",
            target: {
              kind: "menu",
            },
          },
        ],
      },
    },
  }
}

