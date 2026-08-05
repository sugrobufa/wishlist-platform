#!/usr/bin/env bash
#
# Бэкап базы (тикет 28). Один файл — весь дамп, сжатый gzip; хранится 7 дней.
# Внешних хранилищ нет намеренно: MVP на одном сервере, лишний секрет и
# лишний внешний сервис на этом этапе дороже пользы.
#
#   cd /opt/wishlist && ./deploy/backup.sh
#
# Каждую ночь в 3:30 (от пользователя деплоя, `crontab -e`):
#   30 3 * * * cd /opt/wishlist && ./deploy/backup.sh >> /opt/wishlist/backups/backup.log 2>&1
#
# Восстановление — в docs/DEPLOY.md, раздел «Бэкапы».
#
# ⚠ Копия лежит на ТОМ ЖЕ сервере: она спасает от неудачной миграции и
# случайного удаления, но не от потери самого сервера. Раз в месяц полезно
# скачать свежий файл к себе: scp deploy@СЕРВЕР:/opt/wishlist/backups/…

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

cd "$APP_DIR"
[ -f "$COMPOSE_FILE" ] || { echo "Нет $COMPOSE_FILE" >&2; exit 1; }

# Имя и пользователь базы — из того же .env, что и у приложения.
# tr -d '\r' — .env мог быть отредактирован в Windows.
PG_USER="$(sed -n 's/^POSTGRES_USER=//p' .env | tr -d '\r' | tail -1)"
PG_DB="$(sed -n 's/^POSTGRES_DB=//p' .env | tr -d '\r' | tail -1)"
PG_USER="${PG_USER:-wishlist}"
PG_DB="${PG_DB:-wishlist}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
TARGET="$BACKUP_DIR/wishlist-$STAMP.sql.gz"
# Пишем во временный файл: оборванный дамп не должен выглядеть как готовый.
TMP="$TARGET.part"

echo "[$(date '+%F %T')] дамп → $TARGET"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --clean --if-exists --no-owner --no-privileges -U "$PG_USER" "$PG_DB" |
  gzip -9 >"$TMP"

# pg_dump в конвейере: без PIPESTATUS его провал спрятался бы за успехом gzip.
if [ "${PIPESTATUS[0]}" -ne 0 ]; then
  rm -f "$TMP"
  echo "pg_dump упал — бэкап не создан" >&2
  exit 1
fi

mv "$TMP" "$TARGET"
echo "[$(date '+%F %T')] готово, размер $(du -h "$TARGET" | cut -f1)"

# Ротация: всё старше KEEP_DAYS суток удаляем. Недельного окна хватает,
# чтобы заметить беду и откатиться; больше — упрёмся в диск VPS.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'wishlist-*.sql.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
echo "[$(date '+%F %T')] удалено старых копий: $DELETED; осталось: $(find "$BACKUP_DIR" -maxdepth 1 -name 'wishlist-*.sql.gz' | wc -l)"
