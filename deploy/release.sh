#!/usr/bin/env bash
#
# Выпуск новой версии на сервере (тикет 28). Зовёт его GitHub Actions по ssh
# (.github/workflows/deploy.yml), но руками работает точно так же:
#
#   cd /opt/wishlist && ./deploy/release.sh sha-1a2b3c4
#
# Порядок: скачать образ → миграции → перезапустить → проверить здоровье →
# при провале ВЕРНУТЬ ПРЕДЫДУЩИЙ ОБРАЗ и упасть с ненулевым кодом.
#
# ⚠ Откатывается образ, а не база. Миграции Prisma накатываются вперёд и
# автоматически не отменяются: старый образ поедет на новой схеме. Поэтому
# правило — миграции обратно совместимые (сначала добавить колонку, потом,
# отдельным выпуском, перестать пользоваться старой). Развалившуюся схему
# чинят из бэкапа (deploy/backup.sh), а не откатом.

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
ENV_FILE="$APP_DIR/.env"
STATE_FILE="$APP_DIR/.last-good-tag"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

NEW_TAG="${1:-}"
if [ -z "$NEW_TAG" ]; then
  echo "Использование: $0 <тег-образа>   (например sha-1a2b3c4 или latest)" >&2
  exit 2
fi

cd "$APP_DIR"
[ -f "$COMPOSE_FILE" ] || { echo "Нет $COMPOSE_FILE — сначала выложите код" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — создайте по .env.prod.example" >&2; exit 1; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Текущий тег читаем из .env — это единственный источник правды и для
# автоматики, и для владельца, который зайдёт руками. tr -d '\r' — на случай
# .env, отредактированного в Windows: невидимый возврат каретки прилип бы к
# тегу образа и `docker pull` искал бы несуществующее.
current_tag() { sed -n 's/^APP_TAG=//p' "$ENV_FILE" | tr -d '\r' | tail -1; }

# Полная ссылка на образ ровно из тех же строк .env, что читает compose.
image_ref() {
  printf '%s:%s' "$(sed -n 's/^APP_IMAGE=//p' "$ENV_FILE" | tr -d '\r' | tail -1)" "$(current_tag)"
}

set_tag() {
  local tag="$1" tmp
  tmp="$(mktemp)"
  if grep -q '^APP_TAG=' "$ENV_FILE"; then
    sed "s|^APP_TAG=.*|APP_TAG=$tag|" "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"
    echo "APP_TAG=$tag" >>"$tmp"
  fi
  # cat > сохраняет владельца и права исходного файла, mv — нет.
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

# Здоров ли выпуск. Требование строгое — status ровно "ok": и база, и redis.
# (Контейнер считается живым и при "degraded" — см. src/app/api/health/route.ts;
# но ПРИНИМАТЬ деградировавший выпуск нельзя, это и есть повод откатиться.)
health_ok() {
  compose exec -T app node -e '
    fetch("http://127.0.0.1:" + (process.env.PORT || 3000) + "/api/health")
      .then((r) => r.json())
      .then((j) => {
        const d = j && j.data ? j.data : {};
        console.log("health:", JSON.stringify(d));
        process.exit(d.status === "ok" ? 0 : 1);
      })
      .catch((e) => { console.log("health: " + e); process.exit(1); });
  ' 2>/dev/null
}

wait_healthy() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if health_ok; then return 0; fi
    sleep 5
    waited=$((waited + 5))
    printf '    жду готовности… %ss\n' "$waited"
  done
  return 1
}

# Применить тег, который уже записан в .env, и дождаться здоровья.
# ВСЕ шаги здесь мягкие (|| return / || true) — иначе set -e убил бы скрипт
# до отката. Особенно `up -d`: он ждёт здоровья app ради зависимости caddy и
# возвращает ошибку, если тот не поднялся, — а это ровно тот случай, ради
# которого откат и написан. Приговор выносит только проверка здоровья.
apply_release() {
  log "Скачиваю образ"
  # Неудача pull — ещё не приговор: образ этого тега мог быть уже скачан
  # (повтор того же выпуска, моргнувшая сеть, откат на прошлый тег). Теги у
  # нас содержательные (sha-<коммит>), одно и то же имя не может означать
  # разный код, поэтому уже лежащий образ — тот самый. Нет ни в registry,
  # ни локально — вот тогда дальше идти незачем.
  if ! compose pull app; then
    if docker image inspect "$(image_ref)" >/dev/null 2>&1; then
      log "registry недоступен, но образ $(image_ref) уже есть локально — продолжаю"
    else
      echo "Образ $(image_ref) не скачался, и локально его нет" >&2
      return 1
    fi
  fi

  log "Поднимаю базу, очередь и хранилище"
  compose up -d postgres redis minio || return 1

  log "Миграции (prisma migrate deploy)"
  # Одноразовый контейнер из нового образа: схема приезжает вместе с кодом.
  compose run --rm -T app npx prisma migrate deploy || return 1

  log "Перезапускаю приложение и воркер"
  compose up -d --remove-orphans || true

  log "Проверяю здоровье"
  wait_healthy
}

PREVIOUS_TAG="$(current_tag)"
[ -n "$PREVIOUS_TAG" ] || PREVIOUS_TAG="$(cat "$STATE_FILE" 2>/dev/null || true)"

log "Выпуск $NEW_TAG (предыдущий: ${PREVIOUS_TAG:-нет})"

set_tag "$NEW_TAG"
if apply_release; then
  echo "$NEW_TAG" >"$STATE_FILE"
  log "Выпуск $NEW_TAG принят"
  compose ps
  # Старые образы копятся и съедают диск маленького VPS.
  docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
  exit 0
fi

# ------------------------------------------------------------- откат ----
log "ЗДОРОВЬЕ НЕ ПОДТВЕРЖДЕНО — откат"
compose logs --tail=60 app || true

if [ -z "$PREVIOUS_TAG" ] || [ "$PREVIOUS_TAG" = "$NEW_TAG" ]; then
  echo "Откатываться некуда (предыдущий тег: '${PREVIOUS_TAG:-нет}'). Выпуск оставлен как есть." >&2
  exit 1
fi

set_tag "$PREVIOUS_TAG"
compose pull app || true
compose up -d --remove-orphans || true

if wait_healthy; then
  echo "Откат на $PREVIOUS_TAG выполнен, сайт работает. Выпуск $NEW_TAG отклонён." >&2
else
  echo "Откат на $PREVIOUS_TAG НЕ помог — нужен человек. Смотрите: docker compose -f $COMPOSE_FILE logs" >&2
fi
exit 1
