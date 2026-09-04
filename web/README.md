# web — фронтенд 2wel

React 19 + Vite + TypeScript: лендинг, кабинет `/app`, конструкторы шаблонов (v1/v2), гостевой плеер 9:16.

## Разработка

Из корня репозитория или из этой папки:

```bash
npm install
npm run dev
```

`npm run dev` поднимает Postgres (docker), API на `:3000` и Vite на `:5173`.

| URL | Что |
|-----|-----|
| http://localhost:5173/ | Лендинг 2wel |
| http://localhost:5173/login | Вход в кабинет |
| http://localhost:5173/app | Кабинет |
| http://localhost:5173/`{shareId}` | Гостевой плеер |

Сборка образа для Docker — из корня: `docker compose build web` (см. корневой [`README.md`](../README.md)).

Модель данных и API: [`SPEC.md`](../SPEC.md).
