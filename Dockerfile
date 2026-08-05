# syntax=docker/dockerfile:1.7
#
# Прод-образ wishlist-platform (тикет 28). ОДИН образ на два процесса:
#   app    → node server.js          (Next.js standalone)
#   worker → npm run worker          (BullMQ, тот же код, другая команда)
# Отдельный образ воркеру не нужен: он импортирует те же src/server/*
# (prisma, s3, mailer, parser) — два образа означали бы две сборки одного
# и того же кода и риск их расхождения.
#
# База — Debian bookworm-slim, не alpine: Prisma на musl требует отдельного
# движка и регулярно спотыкается о версию openssl. Разница в весе (~30 МБ)
# для одного VPS не стоит этого класса отказов.
#
# Стадии: deps (полный npm ci, сборочный) → builder (next build) →
# prod-deps (только прод-зависимости) → runner (финальный, non-root).

ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------- base ----
FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# openssl — движку Prisma; ca-certificates — исходящему HTTPS (safeFetch,
# S3, SMTP). В slim-образе их нет.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------- deps ----
# Полный npm ci со скриптами: postinstall репозитория — `prisma generate`,
# он же скачивает движки. Кэш слоя держится, пока не менялись lock и схема.
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------- builder ----
FROM deps AS builder
COPY . .
# Токены Tailwind генерируются из design/package/handoff/tokens.json — как в CI.
RUN npm run tokens && npm run build

# ----------------------------------------------------------- prod-deps ----
# node_modules для ВОРКЕРА и миграций (у app свой срез внутри standalone).
#
# --ignore-scripts обязателен: postinstall репозитория зовёт `prisma generate`,
# а CLI prisma живёт в devDependencies и в прод-наборе его нет. Поэтому всё
# присмовское (сгенерированный клиент .prisma, движки @prisma/*, сам CLI для
# `migrate deploy`) и esbuild-бинарь для tsx приносим готовыми из deps —
# ровно тех версий, что в lock-файле, без доустановок из сети.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=deps /app/node_modules/@esbuild ./node_modules/@esbuild
# Ссылку в .bin делаем сами, а не копируем из deps: COPY по-разному
# обходится с символическими ссылками, а `npx prisma` без неё полез бы
# качать CLI из сети прямо во время выпуска.
RUN ln -sf ../prisma/build/index.js node_modules/.bin/prisma \
  && node_modules/.bin/prisma --version >/dev/null

# -------------------------------------------------------------- runner ----
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Владельца файлам НЕ меняем (никаких --chown): всё содержимое образа —
# код и зависимости, которые процессу нужны только на чтение. Пусть лежит
# от root'а с правами 755, а работает всё под node — приложение физически
# не может переписать собственный код. Заодно это резко ускоряет сборку:
# --chown на ~100k файлов node_modules переписывает каждый inode.
# Единственный каталог, куда рантайм пишет, — .next/cache (ниже).

# Standalone-выход: server.js + свой срез node_modules + серверный .next.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Полный прод-набор поверх среза standalone. COPY сливает каталоги, не
# затирая их: срез остаётся, сверху ложатся tsx, bullmq, prisma CLI и прочее,
# что нужно воркеру и миграциям.
COPY --from=prod-deps /app/node_modules ./node_modules

# Схема и миграции — для `prisma migrate deploy` на выпуске.
COPY prisma ./prisma
# Исходники воркера: в проде он идёт через tsx (см. CMD воркера в
# docker-compose.prod.yml). tsx — единственный рантайм TypeScript, который
# умеет пути из tsconfig (`@/*` и `@design/*`); воркер тянет
# src/server/parser → `@design/zones.json`, поэтому голым node его не
# запустить, а вторая, ничем не покрытая сборка воркера — лишний путь кода.
# Следствие этого решения: всё, что воркер импортирует напрямую (tsx и
# dotenv), обязано лежать в dependencies, а не в devDependencies —
# в package.json оба переехали именно поэтому.
COPY src ./src
COPY tsconfig.json ./

# ВАЖНО. Кадры комнат — не статика Next и не public/: маршрут /rooms/[image]
# ЧИТАЕТ ИХ С ДИСКА в рантайме (`process.cwd()/design/package/refs`, см.
# route.ts). Без них комната в проде отдаёт 404 вместо интерьера.
# Трассировщик standalone сейчас угадывает этот путь и кладёт refs сам, но
# это эвристика по строковым литералам: она отвалится от любой перестановки
# в route.ts и молча — падения сборки не будет, будет пустая комната.
# Поэтому копируем явно и не полагаемся на догадку.
#
# handoff/ нужен рядом по другой причине: воркер идёт через tsx и резолвит
# `@design/zones.json` в design/package/handoff УЖЕ В РАНТАЙМЕ — в отличие
# от app, где те же JSON вшиты в бандл на сборке.
COPY design/package/refs ./design/package/refs
COPY design/package/handoff ./design/package/handoff

# Единственное место, куда рантайм ПИШЕТ: кэш ISR гостевых комнат
# (ARCHITECTURE §9). Только его и отдаём во владение node.
RUN mkdir -p .next/cache && chown node:node .next/cache

USER node
EXPOSE 3000

# Пробы — самим node: curl/wget в slim-образе нет, ставить их ради health
# незачем (fetch у node 22 глобальный). Контракт статусов — в route.ts:
# 200 «жив» (включая degraded без Redis), 503 «БД недоступна».
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
