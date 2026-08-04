# 04 — Карточка добавления: «Что это для тебя», ручное добавление

**What to build:** Флоу добавления вещи (турн 8 макета): первый вопрос —
«Что это для тебя?» с двумя тайлами «Люблю» / «Хочу» (язык комнаты: плотный
предмет vs пунктир со светящейся полкой). Дальше поля по состоянию; сохранение
кладёт вещь в зону, она появляется в сцене и сетке.

**Blocked by:** 03.

**Status:** done

- [x] Вопрос состояния ВМЕСТО «добавить в вишлист»; тайлы цитируют язык комнаты
- [x] WANT: заголовок, зона, цена+валюта (обязательны), видимость цены (все/друзья/только я/никому), размер/цвет/желание(1–4), фото (upload в MinIO через pre-signed), ссылка опционально
- [x] LOVE: заголовок, зона, фото/подпись («уже моё» | даритель+год), без цены
- [x] Кнопка сохранения — «полоса света» (турн 22); services/items.create с Zod; ownership
- [x] Сохранение инвалидирует кэш комнаты (revalidateTag)
- [x] Unit: create WANT без цены — ошибка валидации; create LOVE с ценой — цена отбрасывается

## Comments

- Сделано: маршрут `/room/add` (`?zone=…` предвыбирает зону из видимых; чужие
  ключи молча игнорируются). Шаг 1 — «Что это для тебя?»: два CSS-тайла по
  items.json → whereAsked (у «Люблю» плотный предмет с ореолом акцента комнаты
  и обычной полкой; у «Хочу» пунктирный контур + светящаяся полка 2px акцентом),
  подписи — cardCopy из items.json («Уже моё. Просто покажи» / «В подарок.
  Место готово»). Шаг 2 — форма по состоянию: общие поля (заголовок*, зона —
  селект с подписями zones.json, заметка, фото, ссылка); WANT — цена*+валюта*
  (₽ дефолт; запятая нормализуется в точку), видимость цены сегментами
  «Все/Только друзья/Только я/Никто», размер/цвет, «насколько хочется» —
  лесенка из 4 ступеней с подписями («пусть будет…мечтаю», повторный тап
  снимает); LOVE — сегмент «Уже моё | Подарок» (даритель+год), полей цены НЕТ
  в разметке вовсе. Сохранение — «полоса света» по tokens.json → button.primary
  (rest/hover/active-ореолы, easing из motion.json), после — redirect в
  `/room/zone/{zone}`: вещь сразу в сетке, демо-призраки зоны исчезают сами
  (логика тикета 03 «показывать пул только при нуле своих вещей»).
- Сервис: `createItem(userId, input)` (src/server/services/items.ts) —
  `createItemInputSchema` дискриминирована по state: WANT требует price
  (Decimal-строка ≤12,2, >0) и currency (ISO 4217); LOVE отбрасывает
  price/currency/size/desire ДО записи (strip незнакомых ключей формы).
  Ownership: roomId в инпуте НЕ существует — комната берётся по userId;
  зона обязана входить в видимые зоны пресета минус zonesOff; photoKey обязан
  начинаться с `items/{roomId}/` СВОЕЙ комнаты (чужой ключ/URL/refs — отказ,
  хотлинк-заслон). source=MANUAL. После записи `revalidateTag(roomCacheTag
  (roomId), "max")` — в Next 16 revalidateTag двухаргументный, "max" =
  документированный эквивалент старого вызова; вне request-scope (vitest)
  вызов молча гасится. Экспортирован `roomCacheTag(roomId)` = `room-{roomId}`
  — гостевой странице (тикет 07) подписываться на него же.
- **Зависимости: добавлены ровно две** — `@aws-sdk/client-s3` (клиент S3/MinIO:
  HeadBucket/CreateBucket/PutObject/GetObject) и `@aws-sdk/s3-request-presigner`
  (pre-signed PUT для прямой загрузки из браузера). Install-скриптов у них нет,
  allowScripts не трогался.
- S3: `src/server/s3.ts` — ленивый клиент по env (S3_ENDPOINT/S3_ACCESS_KEY/
  S3_SECRET_KEY/S3_BUCKET, forcePathStyle при endpoint — MinIO), `ensureBucket()`
  с мемоизацией (пустой MinIO — бакет создаётся при первом обращении, гонка
  гасится BucketAlreadyOwnedByYou), `presignPut(key, contentType,
  contentLength)` — TTL 5 мин; PUT-подпись не умеет «≤N байт» (только
  POST-policy умеет), поэтому подписывается ТОЧНЫЙ Content-Length: лимит 10 МБ
  проверяет экшен, а сторадж отвергает тело другой длины (проверено против
  MinIO: чужая длина → 403; заметка: подписанный Content-Type MinIO не
  энфорсит — заслон от этого на раздаче, см. ниже). `getObjectStream(key)` —
  веб-стрим + contentType/contentLength, null при отсутствии.
- **Контракт `/media/`**: route handler `GET /media/[...key]`
  (src/app/media/[...key]/route.ts) стримит объект ПУБЛИЧНОГО бакета S3_BUCKET
  по ключу из сегментов. Сегменты строго `[A-Za-z0-9][A-Za-z0-9._-]*` (обход
  пути невозможен по построению), иначе 404; нет объекта — 404. Заголовки:
  `Cache-Control: public, max-age=31536000, immutable` (ключи случайные и не
  переиспользуются), `X-Content-Type-Options: nosniff`, CSP `default-src
  'none'`; Content-Type отдаётся только растровый `image/*` (SVG и прочее —
  octet-stream + attachment: SVG со скриптом с нашего origin был бы XSS).
  DTO-ветка: голый S3-ключ в photoKey → `/media/{key}` (itemPhotoUrl,
  src/server/dto/items.ts; тест-ветка «S3-ключ → null» переписана на новый
  контракт).
- Загрузка фото: клиент валидирует image/* и ≤10 МБ, server action
  `presignItemPhotoAction({contentType, size})` — auth + своя комната + лимит
  `ITEM_PHOTO_MAX_BYTES` + `newItemPhotoKey(roomId, contentType)`
  (`items/{roomId}/{16 hex}.{ext}`; допустимы только растровые jpeg/png/webp/
  avif/gif/heic/heif, image/svg+xml намеренно отвергается) → браузер грузит
  напрямую PUT'ом в MinIO (CORS MinIO по умолчанию пропускает, preflight 204)
  → в `createItemAction` уходит только photoKey.
- Файлы: `src/app/room/add/{page.tsx, add-item-flow.tsx, actions.ts,
  add-item.module.css}`, `src/app/media/[...key]/route.ts`, `src/server/s3.ts`,
  `src/server/services/items.ts` (+createItem и ко), `src/server/dto/items.ts`
  (только ветка itemPhotoUrl), ns `AddItem` в `messages/{ru,en}.json`
  (точечные вставки), `tests/{items.create, items.create-schema}.test.ts`,
  правка ветки в `tests/items.dto.test.ts`, `package.json`+lock (2 пакета).
- Проверено: `npm run typecheck` и `npm run lint` чисто; `npm test` 211/211
  (17 файлов; +25 моих: схема — обязательность цены/валюты WANT, отбрасывание
  цены у LOVE, нормализация «14900,50», границы desire/года, url только
  http(s), photoKey только нашего вида, ключ/лимит/типы фото; сервис на
  реальной БД — happy path обоих состояний, WANT без цены ZodError и ничего
  не записано, LOVE с ценой в инпуте → в БД null, зона чужого набора и
  zonesOff-зона → ZONE_NOT_VISIBLE, без комнаты → NO_ROOM, подсунутый roomId
  игнорируется, чужой photoKey → FOREIGN_PHOTO_KEY, receivedAt хранит год).
  Живой смоук: ensureBucket на живом MinIO, PUT по pre-signed (чужая длина —
  403), стрим байт-в-байт; в браузере на dev-комнате (bold): оба флоу целиком
  — WANT с ценой «12300,50» → в БД Decimal 12300.5/RUB/FRIENDS/desire 3/
  source MANUAL; LOVE с дарителем+годом и фото → preflight 204, PUT 200,
  плитка «Подарен в 2024 · мама», фото отрисовано с `/media/items/…` (200,
  immutable); redirect в зону, призраки зоны исчезли; `/media` мимо ключа,
  с трэверсал-сегментами и точечными сегментами — 404. Тестовые вещи из БД
  и смоук-объекты из MinIO удалены.
- Тикету 06 (добавление по URL): карточка готова к встраиванию — шаг 2 это
  контролируемая форма `AddItemFlow`; предзаполнение от парсера ляжет как
  начальные значения (title/price/currency/photoKey/url/зона-подсказка).
  `createItem` уже принимает url; для source=URL сервису понадобится либо
  параметр source, либо отдельная ветка — сейчас жёстко MANUAL. image.ingest
  клади фото тем же ключом `items/{roomId}/…` — раздача через /media уже
  работает, itemPhotoUrl ничего менять не надо. Поле «Ссылка» в форме — точка
  входа: вставка URL может триггерить POST /api/v1/parse прямо из карточки.
- Тикету 13 (аватар): используй этот же `src/server/s3.ts` (ensureBucket +
  presignPut + getObjectStream); ключ вида `avatars/{userId}/{random}.{ext}`
  пройдёт через /media как есть (маршрут отдаёт любой безопасный ключ
  публичного бакета). Учти: photoKey-схема createItem принимает только
  `items/…` — аватару своя валидация. SVG не пускать по той же причине (XSS).
- Заметки: (1) Подписанный Content-Type MinIO на pre-signed PUT не проверяет
  (проверяет длину) — тип в БД не участвует, а /media отдаёт только растровые
  image/*, так что подмена типа ничего не даёт. (2) `revalidateTag` в тестах
  вне request-scope гасится try/catch — если Next однажды разрешит вызов без
  scope, поведение не изменится. (3) Ссылки «добавить вещь» из комнаты/зоны
  не добавлял — страницы комнаты вне моих файлов; точка входа `/room/add`
  (+`?zone=`) готова, повесить ссылку — полировка (тикет 16).
