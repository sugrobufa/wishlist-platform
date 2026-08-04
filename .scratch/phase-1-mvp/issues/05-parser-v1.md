# 05 — Парсер v1: normalize + safeFetch + fastPath + кэш + фикстуры РФ

**What to build:** Изолированный модуль src/server/parser: URL магазина →
ParsedProduct {title, image, price, currency, domain, canonicalUrl, confidence}.
Порядок: JSON-LD Product → OG/Twitter → эвристики. Весь исходящий трафик —
только через safeFetch с полной SSRF-защитой.

**Blocked by:** None — can start immediately (параллелен 01–04).

**Status:** ready-for-agent

- [ ] normalize: https, lower-host, удаление utm/ref/spm/yclid/fbclid/_openstat…, разворот коротких ссылок ≤5 редиректов
- [ ] safeFetch: только http/https и порты 80/443; DNS-резолв ДО запроса и запрет приватных/зарезервированных диапазонов на каждом hop; тело ≤5МБ; таймаут 3с; content-type allowlist; UA WishlistBot/1.0; unit-тесты на SSRF-кейсы (localhost, 169.254.x, редирект в приват)
- [ ] fastPath: JSON-LD → OG → эвристики; определение валюты (₽ по умолчанию для .ru доменов с рублёвыми паттернами)
- [ ] Redis-кэш по canonicalUrl TTL 24ч; token-bucket per-domain
- [ ] Фикстуры HTML 6 РФ-магазинов (Ozon, WB, Яндекс Маркет, Lamoda, Золотое Яблоко, DNS) в __fixtures__ + unit на каждую: title+price+image извлечены
- [ ] Эвристика зоны (категории) по хлебным крошкам/ключевым словам — как подсказка, confidence в ответе
