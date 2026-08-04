# 05 — Парсер v1: normalize + safeFetch + fastPath + кэш + фикстуры РФ

**What to build:** Изолированный модуль src/server/parser: URL магазина →
ParsedProduct {title, image, price, currency, domain, canonicalUrl, confidence}.
Порядок: JSON-LD Product → OG/Twitter → эвристики. Весь исходящий трафик —
только через safeFetch с полной SSRF-защитой.

**Blocked by:** None — can start immediately (параллелен 01–04).

**Status:** done

- [x] normalize: https, lower-host, удаление utm/ref/spm/yclid/fbclid/_openstat…, разворот коротких ссылок ≤5 редиректов
- [x] safeFetch: только http/https и порты 80/443; DNS-резолв ДО запроса и запрет приватных/зарезервированных диапазонов на каждом hop; тело ≤5МБ; таймаут 3с; content-type allowlist; UA WishlistBot/1.0; unit-тесты на SSRF-кейсы (localhost, 169.254.x, редирект в приват)
- [x] fastPath: JSON-LD → OG → эвристики; определение валюты (₽ по умолчанию для .ru доменов с рублёвыми паттернами)
- [x] Redis-кэш по canonicalUrl TTL 24ч; token-bucket per-domain
- [x] Фикстуры HTML 6 РФ-магазинов (Ozon, WB, Яндекс Маркет, Lamoda, Золотое Яблоко, DNS) в __fixtures__ + unit на каждую: title+price+image извлечены
- [x] Эвристика зоны (категории) по хлебным крошкам/ключевым словам — как подсказка, confidence в ответе

## Comments

Сделано (2026-08-04). Модуль `src/server/parser/` — 7 файлов + 6 фикстур;
тесты `tests/parser/` — 6 сьютов, 118 тестов. `npm run typecheck`,
`npm run lint`, `npm test` — чисто (131 тест всего, включая чужие).

**Контракт для тикета 06 (экспорт `src/server/parser/index.ts`):**
- `parseUrl(url, options?)` — весь конвейер: normalize → кэш → token-bucket →
  safeFetch (GET, html) → fastPath → zoneHint → кэш. Бросает
  `ParserError("invalid-url")` на мусоре и `ParserError("rate-limited")` при
  исчерпании 10/мин на домен; ЛЮБАЯ иная неудача (SSRF-блок, таймаут, 404,
  не-HTML) — не исключение, а «честная карточка» `{domain, canonicalUrl,
  confidence: 0.1}` (user story 9). `options.{fetchImpl,lookupImpl,cache}` —
  тестовые швы.
- `parseHtml(html, url)` — чистая функция без сети (для тестов и fallback).
- `ParsedProduct` — `{ title?, description?, imageUrl?, price?, currency?,
  zoneHint?, domain, canonicalUrl, confidence }`; price — строка-Decimal,
  currency — ISO 4217, zoneHint — ключ zones.json.
- `safeFetch`, `SafeFetchError`, `isBlockedAddress` — для image.ingest
  (инвариант №6: единственная точка исходящих запросов).
- `normalizeUrl`, `domainOf`, `isRussianTld`, `zoneHintFor`,
  `ParserCache`/`getDefaultCache` (Redis лениво из REDIS_URL; без Redis —
  без кэша + in-memory bucket).

**Решения по краям (для ревью):**
- confidence: JSON-LD 0.9 / OG 0.7 / эвристики 0.5 (по худшему из
  title+price), −0.2 без цены, −0.05 без картинки; кэшируем только ≥0.4,
  чтобы таймауты не залипали на 24 ч.
- canonicalUrl — нормализованный ФИНАЛЬНЫЙ URL после редиректов;
  `<link rel="canonical">` из страницы сознательно не используется
  (страница может им врать → отравление кэша/дедупа).
- Бюджет 5 редиректов общий: разворот короткой ссылки тратит его, GET
  страницы получает остаток.
- charset: заголовок → `<meta charset>` → utf-8 (RU-магазины бывают в cp1251).
- Фикстуры покрывают весь каскад: Ozon/ЯМ/Lamoda — JSON-LD (число, @graph,
  offers→PriceSpecification), WB — только OG, Золотое Яблоко — OG без цены
  (цена из «14 950 ₽» в вёрстке), DNS — битый JSON-LD → чистые эвристики
  (title-тег с чисткой хвостов, link rel=image_src, частотный ценовой паттерн).
- Playwright-fallback и адаптеры магазинов — Phase 2 (Out of Scope спеки).
