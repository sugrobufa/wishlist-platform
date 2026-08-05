#!/usr/bin/env bash
#
# Первичная настройка чистого сервера Ubuntu под wishlist-platform (тикет 28).
# Запускается ОДИН раз от root, ничего не спрашивает, секретов не содержит.
# Повторный запуск безопасен: каждый шаг сначала проверяет, не сделан ли уже.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/bootstrap.sh -o bootstrap.sh
#   sudo bash bootstrap.sh
#
# Что делает: docker + compose, пользователь деплоя, папка приложения,
# firewall (22/80/443), fail2ban на ssh, отключение входа по паролю,
# swap при малой памяти, автоматические обновления безопасности.
#
# ⚠ ПРО ВХОД ПО ПАРОЛЮ. Скрипт отключает парольный вход по SSH — это
# главная защита сервера, который смотрит в интернет. Отключит он его
# ТОЛЬКО если найдёт уже установленный публичный ключ (в authorized_keys
# root'а или пользователя деплоя). Ключа нет — шаг пропускается с громким
# предупреждением, дверь остаётся открытой, и это надо исправить руками.
# Перед запуском убедитесь, что вход по ключу РАБОТАЕТ в отдельном окне
# терминала. Закрытая сессия и потерянный ключ = потерянный сервер.

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/wishlist}"
SWAP_FILE="/swapfile"
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
ok() { printf '    %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Запускать от root: sudo bash $0" >&2
  exit 1
fi

# --------------------------------------------------------------- пакеты --
log "Базовые пакеты"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  apt-listchanges postgresql-client >/dev/null
ok "ca-certificates, curl, ufw, fail2ban, unattended-upgrades, psql"

# --------------------------------------------------------------- docker --
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker уже установлен — пропускаю"
  ok "$(docker --version)"
else
  log "Docker Engine + плагин compose (официальный репозиторий Docker)"
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker >/dev/null
  ok "$(docker --version)"
fi

# Ротация логов самого docker (на случай контейнеров вне нашего compose).
if [ ! -f /etc/docker/daemon.json ]; then
  log "Ротация логов docker по умолчанию"
  mkdir -p /etc/docker
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
  ok "/etc/docker/daemon.json"
fi

# ------------------------------------------------- пользователь и папка --
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  log "Пользователь $DEPLOY_USER уже есть"
else
  log "Пользователь $DEPLOY_USER"
  # Без пароля: вход только по ключу.
  adduser --disabled-password --gecos "" "$DEPLOY_USER" >/dev/null
  ok "создан"
fi
usermod -aG docker "$DEPLOY_USER"
ok "$DEPLOY_USER состоит в группе docker"

DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"

# Ключ владелец обычно кладёт root'у (через панель хостинга) — переносим его
# пользователю деплоя, чтобы GitHub Actions ходил не под root.
if [ -s /root/.ssh/authorized_keys ] && [ ! -s "$DEPLOY_HOME/.ssh/authorized_keys" ]; then
  log "Копирую публичные ключи root → $DEPLOY_USER"
  cp /root/.ssh/authorized_keys "$DEPLOY_HOME/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
  chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
  ok "ключей перенесено: $(wc -l <"$DEPLOY_HOME/.ssh/authorized_keys")"
fi

log "Папка приложения $APP_DIR"
install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/backups"
ok "$APP_DIR и $APP_DIR/backups"

# ----------------------------------------------------------------- swap --
MEM_KB="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
SWAP_KB="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
if [ "$SWAP_KB" -lt 262144 ] && [ "$MEM_KB" -lt 4194304 ]; then
  # Меньше 4 ГБ памяти и почти нет подкачки: сборка образов и пики Postgres
  # на таком VPS упираются в OOM-killer. 2 ГБ файла подкачки снимают вопрос.
  log "Файл подкачки 2 ГБ (памяти $((MEM_KB / 1024)) МБ)"
  if [ ! -f "$SWAP_FILE" ]; then
    fallocate -l 2G "$SWAP_FILE" || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 status=none
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null
  fi
  swapon "$SWAP_FILE" 2>/dev/null || true
  grep -q "^$SWAP_FILE" /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" >>/etc/fstab
  # Подкачка — страховка от OOM, а не рабочий режим: трогаем её неохотно.
  sysctl -qw vm.swappiness=10
  grep -q "^vm.swappiness" /etc/sysctl.d/99-wishlist.conf 2>/dev/null ||
    echo "vm.swappiness=10" >>/etc/sysctl.d/99-wishlist.conf
  ok "подкачка включена"
else
  log "Файл подкачки не нужен (память $((MEM_KB / 1024)) МБ, swap $((SWAP_KB / 1024)) МБ)"
fi

# ------------------------------------------------------------- firewall --
log "Firewall (ufw): 22, 80, 443"
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment "ssh" >/dev/null
# Апостроф в комментарии ufw не принимает («ERROR: Invalid syntax»), поэтому
# «Let's Encrypt» здесь без него — правило важнее красоты подписи.
ufw allow 80/tcp comment "http (редирект на https + проверка Lets Encrypt)" >/dev/null
ufw allow 443/tcp comment "https" >/dev/null
ufw allow 443/udp comment "http/3" >/dev/null
ufw --force enable >/dev/null
ok "$(ufw status | head -1)"
warn "Порты 5432/6379/9000 намеренно закрыты: база, redis и хранилище видны только контейнерам."

# ------------------------------------------------------------- fail2ban --
log "fail2ban на ssh"
cat >/etc/fail2ban/jail.d/wishlist-sshd.conf <<'CONF'
# Подбор пароля/ключа по ssh: 5 промахов за 10 минут → бан на сутки.
# backend=systemd — в свежих Ubuntu журнал ssh лежит в journald, файла
# /var/log/auth.log может не быть вовсе.
[sshd]
enabled  = true
backend  = systemd
port     = ssh
maxretry = 5
findtime = 10m
bantime  = 24h
CONF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban
ok "джейл sshd включён"

# -------------------------------------------------------- автообновления --
log "Автоматические обновления безопасности"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat >/etc/apt/apt.conf.d/51wishlist-unattended <<'CONF'
// Только security-обновления, и только они. Перезагрузку сервер сам не
// делает — иначе сайт мог бы уехать в ребут посреди дня.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
CONF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
ok "включены (без автоматической перезагрузки)"

# ------------------------------------------------------- ssh по ключу ----
log "Вход по SSH: отключение пароля"
HAS_KEY=0
[ -s /root/.ssh/authorized_keys ] && HAS_KEY=1
[ -s "$DEPLOY_HOME/.ssh/authorized_keys" ] && HAS_KEY=1

if [ "$HAS_KEY" -eq 1 ]; then
  cat >/etc/ssh/sshd_config.d/99-wishlist.conf <<'CONF'
# Вход только по ключу (bootstrap, тикет 28).
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  if sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    ok "пароль отключён, вход только по ключу"
    warn "НЕ ЗАКРЫВАЙТЕ текущее окно, пока не проверите вход по ключу в новом!"
  else
    rm -f /etc/ssh/sshd_config.d/99-wishlist.conf
    warn "Конфиг sshd не прошёл проверку — изменения отменены, вход по паролю остался."
  fi
else
  warn "Публичный ключ на сервере НЕ НАЙДЕН — вход по паролю оставлен включённым."
  warn "Положите ключ в $DEPLOY_HOME/.ssh/authorized_keys и запустите скрипт ещё раз."
fi

# ---------------------------------------------------------------- итог ---
cat <<SUMMARY

────────────────────────────────────────────────────────────
Сервер готов.

  пользователь деплоя : $DEPLOY_USER
  папка приложения    : $APP_DIR
  docker              : $(docker --version | cut -d, -f1)
  compose             : $(docker compose version --short 2>/dev/null || echo "?")
  открытые порты      : 22, 80, 443

Дальше — по docs/DEPLOY.md, шаг «Файл .env на сервере»:
  1) положить в $APP_DIR файл .env (образец — .env.prod.example);
  2) добавить в GitHub три секрета: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY;
  3) нажать Run workflow у «Deploy» — дальше всё само.
────────────────────────────────────────────────────────────
SUMMARY
