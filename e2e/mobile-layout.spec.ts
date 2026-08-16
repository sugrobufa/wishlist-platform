// ТЕЛЕФОННАЯ РАСКЛАДКА — ЗАМЕР ГЕОМЕТРИИ, ТОЛЬКО НА ЧТЕНИЕ (тикет 176).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СПЕК. Владелец принимает работу С ТЕЛЕФОНА, а прогон телефона
// не видел вовсе: у проекта `mobile` стоит `testIgnore: /full-cycle/`, и на
// телефонной ширине гонялся только `home.spec.ts` — две проверки на 559 байт.
// Приёмка 10.08 дала пять замечаний, и все пять телефонные (щель под кадром,
// пустота под несуществующим баром у гостя, знак витрины голым словом, действия
// зоны под сеткой, подсказка без плашки). Каждое поймали ГЛАЗА.
//
// ПОЧЕМУ ЭТОТ СПЕК НИЧЕГО НЕ ПИШЕТ. Гонять `full-cycle` вторым проектом нельзя:
// у него фиксированные e2e-почты и общая dev-БД (см. playwright.config.ts).
// Здесь нет ни одной отправки формы и ни одного создания вещи — спек ходит по
// готовым экранам стенда и меряет прямоугольники. Единственная запись за прогон
// — вход через `/dev-login`: он выпускает одноразовый токен и идемпотентно
// подсевает пустые зоны комнаты СТЕНДА (`demo@wishlist.local`), то есть чужого
// пользователя, за строки которого `full-cycle` не борется. Вход делается ОДИН
// раз на файл (`beforeAll`), дальше его cookie переносится в контекст каждого
// теста — второго токена и второго посева за прогон не бывает.
//
// КОМНАТ У СТЕНДА ДВЕ, И ВТОРАЯ ПУСТАЯ (тикет 190). Комната владельца полна и
// наполняется при каждом входе — «первое действие пустой комнаты» на ней
// проверить нечем, а единственная дорога к пустоте (`/dev-login?fresh=1`) её
// СНОСИТ. Поэтому у стенда есть второй пользователь, чью комнату не наполняет
// никто (`prisma/seed.ts`), и адрес `/dev-login?empty=1`, который входит им и
// НЕ СЕЕТ вовсе. Правило файла от этого не изменилось: вход всё так же один на
// пользователя за прогон и всё так же добывается в `beforeAll`, а записи за
// вторым входом ещё меньше — один токен и ни одной вещи.
//
// РАЗВЯЗКА С `full-cycle` — В КОНФИГЕ, а не здесь: проект `mobile` объявлен
// `dependencies: ["chromium"]` и идёт ПОСЛЕ десктопного, а не рядом с ним. Драка
// была бы не за строки, а за единственный dev-сервер: посев стенда и полный
// цикл дарения упирались бы в одну очередь компиляции Next.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ожиданий «на всякий случай»: спек, который висит по 15 секунд
// ради стабильности, съедает бюджет ночного прогона (так уже было — шаг висел
// 79 секунд). Анимации ждём не таймером, а `getAnimations()` того самого узла,
// который меряем.
//
// ОДНО ИСКЛЮЧЕНИЕ ИЗ «НИЧЕГО НЕ ПИШЕТ» — И ОНО НЕ ПРО СТЕНД (тикет 196, пакет
// 46). «При скрытой цене продукт не печатает ни одного числа денег» — это
// утверждение о вещи, у которой цена СКРЫТА, а магазин есть. На стенде такой
// вещи нет ни одной: посев кладёт всё с `priceVisibility=ALL` и без ссылок, и
// достать её чтением неоткуда. Поэтому у этой проверки СВОЯ комната, заведённая
// и снесённая ею же (`describe` «денежная тишина» в конце файла): своя почта с
// ярлыком прогона, свой `shareSlug`, две вещи. Ни строки стенда, ни строки
// `full-cycle` она не трогает — драки за фикстуру, ради которой правило и
// написано, здесь нет. Всё остальное в файле по-прежнему только читает.
import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { prisma } from "../src/server/db";
import { E2E_BASE_URL } from "./env";

// Тесты идут по очереди в одном воркере, но НЕ каскадом: `serial` погасил бы
// все проверки после первой красной, а нам нужен полный список нарушений за
// один прогон — спек затевался ровно ради него.
//
// «По очереди в одном воркере» держит НЕ эта строка, а `fullyParallel: false`
// у проекта `mobile` в playwright.config.ts: общий `fullyParallel: true` раздаёт
// по воркерам ТЕСТЫ, и файл разъезжался на три части — с тремя `beforeAll`, то
// есть тремя входами и тремя посевами вместо одного. Здесь остаётся ровно
// «не каскадом».
test.describe.configure({ mode: "default" });

/**
 * БЮДЖЕТ ТЕСТА, А НЕ ОЖИДАНИЕ. Ни один шаг здесь столько не ждёт: замеры
 * мгновенны, самая долгая проверка — 15 секунд общего `expect.timeout`.
 * Запас нужен ровно одному: dev-сервер компилирует маршруты ЛЕНИВО, и первый
 * заход на очередной экран (`/room/zone/…`, `/room/add`, комната гостя) стоит
 * секунд десять сверх замера. Замерено: прогретые тесты идут по 1.5–8 с, самый
 * холодный — 27 с. Растить это число ради зелени нельзя: выросло — значит
 * что-то компилируется впервые или сервер занят чужим прогоном.
 *
 * Холодный вход на стенд считается отдельно — см. бюджет `beforeAll` ниже.
 */
test.setTimeout(45_000);

/** Допуск на округление браузером. Больше пикселя — это уже щель. */
const PX = 1;

/** Постоянный таб-бар хозяйки (messages → TabBar.tabsAria). */
const TAB_BAR = 'nav[aria-label="Вкладки"]';

/**
 * Указатель зон в нижней полосе (Scene.indexAria).
 *
 * `:visible` обязателен. Указателей в разметке ДВА — горизонтальная лента
 * десктопа (`zone-index.tsx`) и вертикальный список телефона (`zone-list.tsx`),
 * — и оба берут имя из одного ключа словаря. Лишний гасится медиа-запросом
 * своего модуля (`display: none` убирает его и из дерева доступности), но в
 * DOM он остаётся, и без фильтра мы бы мерили невидимый.
 */
const ZONE_INDEX = 'nav[aria-label="Зоны комнаты"]:visible';

/** Подпись пустой зоны в указателе (Scene.summaryEmpty). */
const EMPTY_ZONE_SUB = "Пока пусто";

type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

/**
 * КАДР КОМНАТЫ — окно сцены (`scene.module.css → .viewport`).
 *
 * Аира у него нет и быть не может: это фотография, а не элемент управления.
 * Turbopack оставляет местное имя класса суффиксом (`scene-module__HASH__viewport`),
 * поэтому ищем по нему, а не по хэшу, — хэш меняется от любой правки файла.
 * Единственность проверяется отдельно: переименуют — упадёт громко, а не
 * замерит соседний узел.
 */
function sceneFrame(page: Page): Locator {
  return page.locator('main.imm [class*="__viewport"]');
}

/** Поверхность под кадром в покое — нижняя полоса (globals.css → .imm-rail-bottom). */
function bottomSurface(page: Page): Locator {
  return page.locator("main.imm .imm-rail-bottom");
}

/**
 * Лист открытой зоны (`zone-panel.tsx`): `section` с именем зоны, то есть
 * role=region. Вторая поверхность под кадром — та, что встаёт на место полосы.
 */
function zoneSheet(page: Page): Locator {
  return page.getByRole("region");
}

async function rectOf(locator: Locator, what: string): Promise<Rect> {
  await expect(locator, `${what}: узла нет на экране`).toBeVisible();
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
      width: r.width,
      height: r.height,
    };
  });
}

/**
 * Замеры — в лог прогона (тот же приём, что у перф-строки full-cycle).
 * Спек про числа, и когда он краснеет, первым делом смотрят на них; а пока он
 * зелёный, строка говорит, ЧТО именно сошлось.
 */
function report(what: string, numbers: Record<string, number | string>): void {
  console.log(`[раскладка ${what}]`, JSON.stringify(numbers));
}

/** «Эти два числа обязаны совпасть» — с обоими числами в тексте падения. */
function expectSame(actual: number, expected: number, what: string): void {
  expect(
    Math.abs(actual - expected),
    `${what}: ${actual.toFixed(1)} против ${expected.toFixed(1)} (расхождение ${(
      actual - expected
    ).toFixed(1)} px)`,
  ).toBeLessThanOrEqual(PX);
}

/**
 * ПРАВИЛО 7: горизонтальной прокрутки нет ни на одном проверенном экране.
 * Зовётся в конце каждого теста своим экраном в подписи.
 */
async function expectNoSideScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${where}: страница едет вбок — scrollWidth ${scrollWidth} при clientWidth ${clientWidth}`,
  ).toBeLessThanOrEqual(clientWidth);
}

/**
 * Дождаться конца CSS-анимаций узла. Партитура `openZone[3]` поднимает тело
 * листа на 18 px (`rise-in`), и замер посреди подъёма врал бы на эти 18.
 * Ждём РОВНО этот узел, а не «секунду на всякий случай»: у готового элемента
 * `finished` резолвится сразу.
 */
async function settled(locator: Locator): Promise<void> {
  await locator.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
}

/**
 * НАЖАТЬ СТРОКУ ЗОНЫ, ПОКА ЗОНА НЕ ОТКРОЕТСЯ — НЕ «ПОДОЖДАТЬ ПОДОЛЬШЕ».
 *
 * Лист зоны рождается из состояния клиента (`SceneStage → openZone`), а до
 * гидратации у строки указателя РАЗМЕТКА УЖЕ ЕСТЬ, А ОБРАБОТЧИКА ЕЩЁ НЕТ:
 * первое нажатие уходит в никуда, и сколько потом ни жди — лист не появится,
 * потому что ждать больше нечего. Ровно так шаг и падал (11.08): 15 секунд
 * ожидания региона, снимок — комната в покое.
 *
 * Ждать дольше было бы и бесполезно, и запрещено (граница 4 тикета 176).
 * Поэтому цикл: нажали — коротко проверили — нажали ещё раз. Повтор безопасен,
 * `openZone` не переключатель: второе нажатие по той же строке снова открывает
 * ту же зону и закрыть её не может.
 *
 * Общий бюджет шага прежний — те же 15 секунд `expect.timeout`, только внутри
 * них мы действуем, а не ждём.
 */
async function openZoneRow(row: Locator, sheet: Locator): Promise<void> {
  await expect(async () => {
    await row.click();
    await expect(sheet).toBeVisible({ timeout: 2_000 });
  }, "зона не открылась: строку нажали, а листа вещей под кадром нет").toPass({
    timeout: 15_000,
    intervals: [250, 500, 1_000],
  });
}

// ---------- Вход на стенд ----------

/**
 * Cookie сессии стенда, добытая РОВНО ОДИН раз за файл (`beforeAll` ниже).
 *
 * Тесты идут в одном воркере по очереди (`mode: "default"`), поэтому переменная
 * жива между ними. Это не оптимизация ради секунд: каждый заход на `/dev-login`
 * — выпуск токена и попытка посева, то есть запись, а спек затевался как
 * читающий. Один вход на весь файл — это и есть его единственная запись.
 */
let standSession: Awaited<ReturnType<BrowserContext["cookies"]>> | null = null;

/**
 * Cookie ВТОРОГО пользователя стенда — того, у кого комната пустая (тикет 190).
 * Добывается там же и на тех же правах: один вход за прогон, ноль записей
 * сверх одноразового токена.
 */
let emptySession: Awaited<ReturnType<BrowserContext["cookies"]>> | null = null;

/**
 * ХОЛОДНЫЙ СТЕНД — ОДИН РАЗ И СО СВОИМ БЮДЖЕТОМ.
 *
 * Вход без письма (`/dev-login`, тикеты 29/31/70): страница уводит на настоящий
 * callback Auth.js, тот заводит сессию и приводит в `/room`.
 *
 * Почему бюджет тут больше, чем у самих замеров, и почему он ЗДЕСЬ, а не
 * размазан по тестам: на пустой базе (ночной прогон в CI — там `prisma db seed`
 * заводит комнату стенда, но без вещей) этот заход ещё и СЕЕТ её целиком —
 * тринадцать зон, вещи через продуктовый `createItem` и предметные кадры в S3.
 * Локально, на уже наполненном стенде, посев вырождается в тринадцать `count`,
 * и весь шаг занимает секунды. Мерить раскладку на пустой комнате нечего,
 * поэтому наполнение — часть подготовки, а не часть проверки.
 */
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await page.goto("/dev-login");
  await expect(
    page,
    "быстрый вход не привёл в комнату: проверь QUICK_LOGIN_* в webServer.env и что у стенда заведена комната",
  ).toHaveURL(/\/room$/);
  standSession = await context.cookies();
  await context.close();

  // Второй вход — второй пользователь, а не второй заход тем же (тикет 190).
  // Контекст свой и чистый: cookie владельца открыла бы его же комнату.
  const emptyContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto("/dev-login?empty=1");
  await expect(
    emptyPage,
    "вход в пустую комнату не сработал: проверь QUICK_LOGIN_EMPTY_EMAIL в webServer.env и что `prisma db seed` завёл этого пользователя с комнатой",
  ).toHaveURL(/\/room$/);
  emptySession = await emptyContext.cookies();
  await emptyContext.close();
});

/** Сессия стенда — в свежий контекст теста. Второго входа не бывает. */
async function signIn(page: Page): Promise<void> {
  expect(standSession, "сессия стенда не добыта — смотри падение beforeAll").not.toBeNull();
  await page.context().addCookies(standSession ?? []);
}

/** Сессия второго пользователя стенда — того, чья комната пуста (тикет 190). */
async function signInEmpty(page: Page): Promise<void> {
  expect(emptySession, "сессия пустой комнаты не добыта — смотри падение beforeAll").not.toBeNull();
  await page.context().addCookies(emptySession ?? []);
}

/** Комната хозяйки на телефоне, вход уже сделан. */
async function openRoom(page: Page): Promise<void> {
  await signIn(page);
  await page.goto("/room");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Открыть первую зону, в которой есть вещи, и вернуть её лист.
 *
 * Зону выбираем ПО ДАННЫМ, а не по имени: набор зон зависит от интерьера
 * комнаты стенда, и прибитый гвоздями ключ («music») сделал бы спек ложно
 * красным на другом пресете. Пустые узнаём по подписи указателя.
 */
async function openSeededZone(page: Page): Promise<Locator> {
  const rows = page.locator(`${ZONE_INDEX} button`);
  await expect(rows.first(), "указателя зон нет — комната стенда пуста?").toBeVisible();

  const sheet = zoneSheet(page);
  const total = await rows.count();
  let opened = false;
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    if ((await row.innerText()).includes(EMPTY_ZONE_SUB)) continue;
    await openZoneRow(row, sheet);
    opened = true;
    break;
  }
  expect(opened, "в комнате стенда нет ни одной зоны с вещами — посев не сработал").toBe(true);

  await expect(sheet, "зона открылась, а листа вещей под кадром нет").toBeVisible();
  return sheet;
}

// ---------- Правила 1, 3, 7: комната хозяйки в покое ----------

test("комната хозяйки: под кадром одна поверхность до таб-бара, в баре четыре знака", async ({
  page,
}) => {
  await openRoom(page);

  await expect(sceneFrame(page), "кадр сцены должен быть ровно один").toHaveCount(1);
  const frame = await rectOf(sceneFrame(page), "кадр комнаты");
  const surface = await rectOf(bottomSurface(page), "поверхность под кадром");
  const bar = await rectOf(page.locator(TAB_BAR), "таб-бар");

  report("комната", {
    кадр: `0…${frame.bottom.toFixed(1)}`,
    поверхность: `${surface.top.toFixed(1)}…${surface.bottom.toFixed(1)}`,
    бар: `${bar.top.toFixed(1)}…${bar.bottom.toFixed(1)}`,
  });

  // ПРАВИЛО 1. Щели быть не может ни сверху, ни снизу.
  expectSame(surface.top, frame.bottom, "верх поверхности против нижней кромки кадра");
  expectSame(surface.bottom, bar.top, "низ поверхности против верха таб-бара");

  // …и поверхность в покое ровно одна: листа зоны на экране нет.
  await expect(zoneSheet(page), "в покое под кадром не должно быть листа зоны").toHaveCount(0);

  // ПРАВИЛО 3. Мест в баре пять (четыре вкладки и кружок «Добавить»), и знак
  // есть у КАЖДОГО: место «Сокровищница» однажды рисовалось голым словом —
  // ветки в `SlotIcon` не было, switch молча отдавал undefined.
  const slots = page.locator(`${TAB_BAR} a`);
  await expect(slots, "мест в баре").toHaveCount(5);

  const tabs = ["Комната", "Друзья", "Сокровищница", "Настройки"];
  for (const name of tabs) {
    const slot = page.locator(TAB_BAR).getByRole("link", { name, exact: true });
    await expect(slot, `вкладка «${name}»`).toHaveCount(1);
    const icon = slot.locator("svg");
    await expect(icon, `у вкладки «${name}» нет знака — она нарисована голым словом`).toHaveCount(
      1,
    );
    const shape = await icon.evaluate((el) => ({
      children: el.childElementCount,
      box: el.getBoundingClientRect().width,
    }));
    expect(shape.children, `знак вкладки «${name}» пуст: в svg нет ни одной фигуры`).toBeGreaterThan(
      0,
    );
    expect(shape.box, `знак вкладки «${name}» нулевой ширины`).toBeGreaterThan(0);
  }

  await expectNoSideScroll(page, "комната хозяйки");
});

/**
 * ПЛАШКА ПРЕДЛОЖЕНИЯ ПРАЗДНИКА — ЖИВОЙ ЗАМЕР (тикет 198, пакет 44).
 *
 * Тикет требует ровно этого: «прямоугольники зон до и после появления плашки
 * совпадают — замер», и «плашка не режется и не накрывает знак сокровищницы».
 * Арифметику держит юнит (tests/occasion-offer-layout.test.ts); здесь числа
 * даёт браузер.
 *
 * ПОЧЕМУ ПЛАШКА ВСТАВЛЯЕТСЯ, А НЕ ЖДЁТСЯ. Она приходит за три недели до общей
 * даты — календарём, а не настройкой; на стенде её нет ни одного дня из
 * одиннадцати месяцев в году. Подделать «сегодня» в браузере значило бы мерить
 * не тот продукт: время считает сервер (полночь UTC), и `Date` страницы на него
 * не влияет. Поэтому в разметку встаёт НАСТОЯЩАЯ плашка — тот же класс, те же
 * правила CSS, то же место (ребёнок `main.imm`, сосед вуали). Проверяется ровно
 * то, ради чего замер и просят: отдаёт ли этот слой сцене хоть пиксель.
 */
test("плашка праздника: стоит в кадре и не двигает ни одной зоны (тикет 198)", async ({ page }) => {
  await openRoom(page);

  /** Цели нажатия всех видимых зон — с именами, чтобы падение было читаемым. */
  const hotspots = async () =>
    page.locator('main.imm [class*="__hotspot"]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return `${node.getAttribute("aria-label") ?? "?"}:${r.left}:${r.top}:${r.width}:${r.height}`;
      }),
    );

  // Знак ИМЕННО из угла сцены (`.imm-corner`): служебные входы шапки нарисованы
  // той же плашкой `.imm-corner-mark`, но на телефоне их нет (`imm-desktop-only`),
  // и первым в DOM попадается как раз невидимый.
  const corner = await rectOf(
    page.locator("main.imm .imm-corner .imm-corner-mark").first(),
    "знак сокровищницы",
  );
  const frameBefore = await rectOf(sceneFrame(page), "кадр комнаты");
  const before = await hotspots();
  expect(before.length, "зон на экране не нашлось — мерить нечего").toBeGreaterThan(5);

  // ВПИСЫВАЕМ ИДЕМПОТЕНТНО И ЖДЁМ, а не «вписали и меряем».
  //
  // Первая редакция шага вписывала плашку один раз и сразу мерила её. В
  // одиночку это проходило, а в полном прогоне падало таймаутом 45 с на
  // ожидании узла — со снимком почти пустой страницы. Причина в том, что
  // `main.imm` живёт под клиентской перерисовкой (комната обновляет себя сама),
  // и вписанный чужой ребёнок при следующей отрисовке исчезает. Кто успел
  // первым — зависело от того, прогрет ли маршрут, то есть от порядка тестов.
  //
  // Повторная вставка НЕ ослабляет проверку: шаг доказывает, что плашка не
  // двигает зоны, а не то, что она переживает перерисовку. Зоны меряются после
  // того, как узел действительно стоит.
  const injectPlaque = () =>
    page.evaluate(() => {
      const host = document.querySelector("main.imm");
      if (!host || host.querySelector(".imm-offer")) return;
      const plaque = document.createElement("section");
      plaque.className = "imm-offer";
      plaque.innerHTML =
        '<p class="imm-offer-title">Через 21 день Новый год</p>' +
        '<p class="imm-offer-line">Показать гостям, что комната ждёт подарков и к нему</p>' +
        '<div class="imm-offer-actions">' +
        '<button type="button" class="imm-offer-show"><span>Показать</span><span>→</span></button>' +
        '<button type="button" class="imm-offer-skip">Не в этом году</button>' +
        "</div>";
      host.append(plaque);
    });

  await injectPlaque();
  await expect
    .poll(
      async () => {
        await injectPlaque();
        return page.locator("main.imm .imm-offer").count();
      },
      { message: "плашка не удержалась в разметке — перерисовка стирает её быстрее, чем мы меряем" },
    )
    .toBeGreaterThan(0);

  const plaqueRect = await rectOf(page.locator("main.imm .imm-offer"), "плашка праздника");
  const frameAfter = await rectOf(sceneFrame(page), "кадр комнаты");
  const after = await hotspots();
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };

  report("плашка праздника", {
    "знак сокровищницы": `${corner.top.toFixed(1)}…${corner.bottom.toFixed(1)}`,
    плашка: `${plaqueRect.top.toFixed(1)}…${plaqueRect.bottom.toFixed(1)}`,
    "поля плашки": `${plaqueRect.left.toFixed(1)} / ${(viewport.width - plaqueRect.right).toFixed(1)}`,
    "высота плашки": Number(plaqueRect.height.toFixed(1)),
    зон: before.length,
    "кадр до": `${frameBefore.top.toFixed(1)}…${frameBefore.bottom.toFixed(1)}`,
    "кадр после": `${frameAfter.top.toFixed(1)}…${frameAfter.bottom.toFixed(1)}`,
  });

  // ГЛАВНОЕ ОБЕЩАНИЕ: ни одна зона не сдвинулась ни на пиксель, и кадр тоже.
  expect(after, "плашка сдвинула зоны — она попала в поток вместо слоя").toEqual(before);
  expectSame(frameAfter.top, frameBefore.top, "верх кадра до и после плашки");
  expectSame(frameAfter.height, frameBefore.height, "высота кадра до и после плашки");

  // ЧИСЛА ПАКЕТА, снятые браузером: поля 14 с обеих сторон, высота от 132.
  expectSame(plaqueRect.left, 14, "левое поле плашки");
  expectSame(viewport.width - plaqueRect.right, 14, "правое поле плашки");
  expect(
    plaqueRect.height,
    `высота плашки ${plaqueRect.height.toFixed(1)} — меньше 132 из пакета`,
  ).toBeGreaterThanOrEqual(132 - PX);

  // ЗАМЕР ЧИСЛА `top`. Пакет зовёт 56 «высотой зоны шапки в кадре»; у нас эта
  // зона — ряд знаков в углу (12 сверху плюс плашка 44). Сходятся они или нет,
  // видно здесь: верх плашки обязан лечь ровно на нижнюю кромку знака.
  expectSame(plaqueRect.top, corner.bottom, "верх плашки против низа знака сокровищницы");
  expectSame(plaqueRect.top, 56, "верх плашки против числа пакета");

  // «НЕ РЕЖЕТСЯ»: плашка целиком в окне и целиком в затемнении шапки.
  expect(plaqueRect.bottom, "плашка вылезла за низ экрана").toBeLessThanOrEqual(viewport.height);
  expect(plaqueRect.top, "плашка накрыла знак сокровищницы").toBeGreaterThanOrEqual(
    corner.bottom - PX,
  );

  await expectNoSideScroll(page, "комната с плашкой праздника");
});

// ---------- Правила 1, 4, 7: открытая зона ----------

test("открытая зона: лист занимает место полосы, действия стоят над сеткой", async ({ page }) => {
  await openRoom(page);
  const sheet = await openSeededZone(page);

  const frame = await rectOf(sceneFrame(page), "кадр комнаты");
  const bar = await rectOf(page.locator(TAB_BAR), "таб-бар");
  const panel = await rectOf(sheet, "лист открытой зоны");

  report("открытая зона", {
    зона: (await sheet.getAttribute("aria-label")) ?? "",
    кадр: `0…${frame.bottom.toFixed(1)}`,
    лист: `${panel.top.toFixed(1)}…${panel.bottom.toFixed(1)}`,
    бар: `${bar.top.toFixed(1)}…${bar.bottom.toFixed(1)}`,
  });

  // ПРАВИЛО 1 во втором положении: под кадром снова ровно одна поверхность —
  // теперь лист. Он стоит на таб-баре и доходит вверх минимум до кромки кадра
  // (выше — только если вещей больше, чем помещается).
  expectSame(panel.bottom, bar.top, "низ листа зоны против верха таб-бара");
  expect(
    panel.top,
    `лист зоны не дотянулся до кадра: верх ${panel.top.toFixed(1)} при нижней кромке кадра ${frame.bottom.toFixed(1)}`,
  ).toBeLessThanOrEqual(frame.bottom + PX);

  // Полоса с указателем зон при этом уходит целиком — иначе под листом остался
  // бы второй экран, живой для клавиатуры и читалки (тикет 140).
  await expect(
    page.locator("main.imm .imm-rail-bottom > div"),
    "при открытой зоне полоса с указателем обязана уйти",
  ).toBeHidden();

  // ПРАВИЛО 4. Действия зоны — над вещами (тикет 139): до них надо доходить
  // сразу, а не мотать лист.
  const body = sheet.locator(':scope > div').first();
  await settled(body);

  const grid = sheet.locator('[id$="-panel"]').first();
  const gridRect = await rectOf(grid, "сетка вещей зоны");

  const actions = sheet.getByRole("link", { name: /Показать все|ещё \d+|Добавить вещь/ });
  const actionsCount = await actions.count();
  expect(actionsCount, "в листе зоны нет строки действий").toBeGreaterThan(0);

  for (let i = 0; i < actionsCount; i += 1) {
    const pill = actions.nth(i);
    const label = (await pill.innerText()).trim();
    const box = await rectOf(pill, `действие «${label}»`);
    expect(
      box.bottom,
      `действие «${label}» стоит ПОД сеткой: низ ${box.bottom.toFixed(1)} против верха сетки ${gridRect.top.toFixed(1)}`,
    ).toBeLessThanOrEqual(gridRect.top + PX);
  }

  await expectNoSideScroll(page, "комната хозяйки с открытой зоной");
});

// ---------- Правила 2, 7: комната гостя ----------

test("комната гостя: таб-бара нет, и пустоты под него тоже нет", async ({ page }) => {
  await signIn(page);

  // Адрес комнаты читается из UI, как в full-cycle: он живёт в настройках,
  // рядом с ником (тикет 24).
  await page.goto("/settings");
  const sharePath = (
    await page
      .getByText(/^\/r\//)
      .first()
      .textContent()
  )?.trim();
  expect(sharePath, "в настройках не нашёлся адрес комнаты").toBeTruthy();

  // Гость приходит БЕЗ сессии: cookie хозяйки на её же комнате дала бы другой
  // канал «занято» и другой вид угла сцены.
  await page.context().clearCookies();
  await page.goto(sharePath as string);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // ПРАВИЛО 2, первая половина: У ГОСТЯ БАР ЕСТЬ, НО ОН ЕГО СОБСТВЕННЫЙ
  // (тикет 247, турн 56b). Здесь до 16.08 стояло «баров ноль» — правда до
  // 14.08, когда владелец не смог добраться до призыва «Собрать свою»
  // (строка ниже списка зон недостижима: список растёт с числом полок), и
  // дизайн отдал призыву третье место бара.
  //
  // Проверять теперь надо не отсутствие полосы, а то, что она ГОСТЕВАЯ: три
  // места вместо пяти и ни одного хозяйкиного действия. «Добавить» в чужую
  // комнату — вещь, которую туда не положишь; «Настройки» — чужие.
  const guestBar = page.locator(TAB_BAR);
  await expect(guestBar, "гостевой бар пропал — призыв «Собрать свою» снова недостижим").toHaveCount(
    1,
  );
  await expect(guestBar.locator("a"), "в гостевом баре не три места").toHaveCount(3);
  await expect(
    guestBar.getByText(/Настройки|Добавить/u),
    "в гостевом баре появилось хозяйкино действие",
  ).toHaveCount(0);

  // …вторая половина: низ последней поверхности доходит до низа окна. Место под
  // бар раскладка когда-то резервировала всем, у кого класс `.imm`, и нижние
  // 86 px гостевого экрана оставались пустыми (тикет 143).
  const frame = await rectOf(sceneFrame(page), "кадр комнаты гостя");
  const surface = await rectOf(bottomSurface(page), "поверхность под кадром у гостя");
  const viewport = await page.evaluate(() => document.documentElement.clientHeight);

  report("комната гостя", {
    кадр: `0…${frame.bottom.toFixed(1)}`,
    поверхность: `${surface.top.toFixed(1)}…${surface.bottom.toFixed(1)}`,
    окно: viewport,
    "мест в баре": await guestBar.locator("a").count(),
  });

  expectSame(surface.top, frame.bottom, "верх поверхности гостя против нижней кромки кадра");
  expectSame(surface.bottom, viewport, "низ поверхности гостя против низа окна");

  await expectNoSideScroll(page, "комната гостя");
});

// ---------- Правила 4, 5, 7: зона целиком списком ----------

test("зона списком: строка 52 px и имя во всю оставшуюся полосу", async ({ page }) => {
  await openRoom(page);
  const sheet = await openSeededZone(page);

  // Дорога на экран «зона целиком списком» — та же пилюля листа. Ключ зоны
  // берём из её адреса, а не выдумываем.
  const full = sheet.getByRole("link", { name: /Показать все|ещё \d+/ }).first();
  const href = await full.getAttribute("href");
  expect(href, "в листе зоны нет дороги на полный экран").toBeTruthy();

  await page.goto(href as string);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // ПРАВИЛО 4 на втором экране: «+ Добавить вещь» стоит НАД списком (тикет 139
  // и его продолжение на этой странице).
  const rows = page.locator("main ul li");
  await expect(rows.first(), "в зоне нет ни одной строки").toBeVisible();
  const firstRow = await rectOf(rows.first(), "первая строка зоны");
  const addLink = page.getByRole("link", { name: /Добавить вещь/ }).first();
  const addRect = await rectOf(addLink, "ссылка «Добавить вещь»");
  expect(
    addRect.bottom,
    `«Добавить вещь» стоит ПОД списком: низ ${addRect.bottom.toFixed(1)} против верха первой строки ${firstRow.top.toFixed(1)}`,
  ).toBeLessThanOrEqual(firstRow.top + PX);

  // ПРАВИЛО 5. Высота строки — 52 ровно (контракт handoff/zone-row.json,
  // тикет 152), и полосу имени не ест никто: остаток строки обязан сойтись с
  // числами контракта — миниатюра 36 + 12, промежуток меты 10, знак «⋯» 6 + 32,
  // огонёк «мечтаю» 5 + 8 там, где он есть.
  const measured = await rows.evaluateAll((items) =>
    items.map((li) => {
      const box = li.firstElementChild as HTMLElement | null;
      const pick = (suffix: string) =>
        box?.querySelector<HTMLElement>(`[class*="__${suffix}"]`) ?? null;
      const width = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().width : 0);
      const name = pick("name");
      return {
        height: box ? box.getBoundingClientRect().height : 0,
        rowWidth: box ? box.getBoundingClientRect().width : 0,
        nameWidth: width(name),
        nameOverflow: name ? name.scrollWidth - name.clientWidth : 0,
        thumb: width(pick("thumb")),
        dot: width(pick("dot")),
        meta: width(pick("meta")),
        more: width(pick("more")),
        title: name?.textContent ?? "",
      };
    }),
  );

  expect(measured.length, "строк зоны не нашлось").toBeGreaterThan(0);
  const widest = measured.reduce((a, b) => (a.nameWidth > b.nameWidth ? a : b));
  const narrowest = measured.reduce((a, b) => (a.nameWidth < b.nameWidth ? a : b));
  report("зона списком", {
    адрес: href as string,
    строк: measured.length,
    высота: measured[0]?.height ?? 0,
    "полоса имени": `${narrowest.nameWidth.toFixed(1)}…${widest.nameWidth.toFixed(1)}`,
    "самое узкое имя": narrowest.title,
  });

  for (const row of measured) {
    expectSame(row.height, 52, `высота строки «${row.title}»`);

    // Промежутки контракта: 12 после миниатюры, 8 после огонька, 10 перед
    // метой, 6 перед знаком. Всё, что не съели соседи, принадлежит имени.
    const reserved =
      row.thumb + 12 + (row.dot > 0 ? row.dot + 8 : 0) + (row.meta > 0 ? row.meta + 10 : 0) +
      (row.more > 0 ? row.more + 6 : 0);
    expectSame(
      row.nameWidth,
      row.rowWidth - reserved,
      `полоса имени «${row.title}» (строка ${row.rowWidth.toFixed(1)}, соседи ${reserved.toFixed(1)})`,
    );
    expect(
      row.nameOverflow,
      `имя «${row.title}» обрезано: нужно ${(row.nameWidth + row.nameOverflow).toFixed(1)} px, дано ${row.nameWidth.toFixed(1)}`,
    ).toBeLessThanOrEqual(PX);
  }

  await expectNoSideScroll(page, "зона списком");
});

// ---------- Правила 6, 7: карточка добавления ----------

test("карточка добавления: ничего не выезжает вправо, «Сохранить» на виду", async ({ page }) => {
  await signIn(page);
  await page.goto("/room/add");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // ПРАВИЛО 6, первая половина: ни один узел карточки не заходит за правую
  // кромку окна. Меряем ВСЕ видимые узлы — виноватым чаще всего оказывается не
  // тот, о ком думаешь.
  const overhang = await page.evaluate(() => {
    const edge = document.documentElement.clientWidth;
    const out: Array<{ tag: string; cls: string; right: number; text: string }> = [];
    for (const el of Array.from(document.querySelectorAll("main *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= edge + 1) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute("class") ?? "",
        right: Math.round(r.right * 10) / 10,
        text: (el.textContent ?? "").trim().slice(0, 40),
      });
    }
    return { edge, out };
  });
  expect(
    overhang.out,
    `за правую кромку окна (${overhang.edge}) выехали узлы карточки`,
  ).toEqual([]);

  // ПРАВИЛО 6, вторая половина: главная кнопка видна без прокрутки. Она
  // sticky-полоса внизу формы, и бара под ней нет вовсе — но проверяем не
  // устройство, а результат: кнопка целиком в окне и ничем не накрыта.
  const save = page.locator("form").getByRole("button").and(page.locator('[type="submit"]'));
  const button = await rectOf(save, "кнопка сохранения");
  const viewport = await page.evaluate(() => document.documentElement.clientHeight);
  report("карточка добавления", {
    окно: `${overhang.edge}×${viewport}`,
    "правый вылет": overhang.out.length,
    "кнопка сохранения": `${button.top.toFixed(1)}…${button.bottom.toFixed(1)}`,
  });
  expect(
    button.bottom,
    `кнопка сохранения ушла за низ окна: ${button.bottom.toFixed(1)} при высоте окна ${viewport}`,
  ).toBeLessThanOrEqual(viewport + PX);
  expect(button.top, "кнопка сохранения уехала выше окна").toBeGreaterThanOrEqual(-PX);

  const bar = page.locator(TAB_BAR);
  if ((await bar.count()) > 0) {
    const barRect = await rectOf(bar, "таб-бар");
    expect(
      button.bottom,
      `кнопка сохранения спрятана под баром: низ ${button.bottom.toFixed(1)}, верх бара ${barRect.top.toFixed(1)}`,
    ).toBeLessThanOrEqual(barRect.top + PX);
  }

  // …и она реально нажимаема в этой точке: под её серединой лежит она сама, а
  // не чужой слой. Ничего не нажимаем — только спрашиваем у браузера.
  const onTop = await save.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(hit) || hit === el;
  });
  expect(onTop, "середину кнопки сохранения накрывает чужой слой").toBe(true);

  await expectNoSideScroll(page, "карточка добавления");
});

// ---------- Правила 1, 7 и тикет 188: полоса под кадром не режет содержимое ----------

/**
 * Сколько абзацев кладём в полосу. Заведомо больше, чем влезает на 375×812:
 * там под полосу остаётся около 500 px, а строк тут на добрую тысячу.
 */
const LONG_LINES = 14;

/**
 * Класс слота `below` — ИЗ ТАБЛИЦ СТИЛЕЙ САМОЙ СТРАНИЦЫ, а не выдуманный.
 *
 * Turbopack хэширует местные имена CSS-модулей (`zone-index-module__HASH__below`),
 * и хэш меняется от любой правки файла. Ищем по окончанию имени — так же, как
 * кадр сцены ищется по `__viewport`. Хвост `(?![\w-])` обязателен: рядом живёт
 * `belowBare`, и без него нашлись бы оба.
 *
 * Найтись обязано РОВНО ОДНО имя: переименуют слот — тест упадёт громко, а не
 * подложит содержимое в узел без стилей и объявит, что всё сошлось.
 */
async function railSlotClass(page: Page): Promise<string> {
  const names = await page.evaluate(() => {
    const found = new Set<string>();
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const nested = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined;
        if (nested) walk(nested);
        const selector = (rule as CSSStyleRule).selectorText;
        if (!selector) continue;
        for (const hit of selector.matchAll(/\.([\w-]+__below)(?![\w-])/gu)) {
          if (hit[1]) found.add(hit[1]);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        // Лист с чужого источника читать нельзя — наших модулей там нет.
      }
    }
    return [...found];
  });
  expect(names, "класс слота полосы не нашёлся в таблицах стилей страницы").toHaveLength(1);
  return names[0] as string;
}

/**
 * Положить в полосу «СЛЕДУЮЩИЙ ДЛИННЫЙ ТЕКСТ» — тот самый, ради которого высота
 * полосы стала потолком.
 *
 * ПОЧЕМУ ТЕКСТ ПРИНОСИМ СВОЙ. Мерить надо ПЕРЕПОЛНЕННУЮ полосу, а комната
 * стенда полна: слот `below` в ней пуст (плашка «ссылку лучше отдавать от пяти
 * вещей» живёт только до пятой вещи, а блок первого шага — только в пустой).
 * Пустой комнаты у этого спека нет и быть не может: к ней ведёт единственная
 * дорога `/dev-login?fresh=1`, а она СНОСИТ комнату стенда — запись, и
 * разрушительная (см. шапку файла: спек ничего не пишет).
 *
 * Узел кладётся в тот же слот и ТЕМ ЖЕ КЛАССОМ ПРОДУКТА, то есть в те же
 * стили: `zone-rail.tsx` рисует здесь ровно `<div className={s.below}>`.
 * Слот уже есть — дополняем его, нет — заводим на его законном месте,
 * последним ребёнком стопки. В БД не пишется ничего: узел живёт во вкладке
 * до конца теста.
 */
async function growRailSlot(page: Page, className: string): Promise<Locator> {
  await page.evaluate(
    ({ className, lines }) => {
      const stack = document.querySelector("main.imm .imm-rail-bottom > div");
      if (!stack) throw new Error("стопки нижней полосы нет — класть некуда");
      const own = stack.querySelector<HTMLElement>(`.${CSS.escape(className)}`);
      const slot = own ?? document.createElement("div");
      if (!own) {
        slot.className = className;
        stack.append(slot);
      }
      slot.setAttribute("data-e2e-long", "1");
      for (let i = 0; i < lines; i += 1) {
        const line = document.createElement("p");
        line.setAttribute("data-e2e-line", String(i));
        line.style.margin = "0 0 8px";
        line.textContent =
          `${i + 1}. Следующий длинный текст в полосе под кадром: он обязан ` +
          "прокручиваться внутри полосы, а не срезаться нижним баром.";
        slot.append(line);
      }
    },
    { className, lines: LONG_LINES },
  );
  return page.locator('[data-e2e-long="1"]');
}

/**
 * ПОЛОСА ПОД КАДРОМ ДЕРЖИТ СВОЁ СОДЕРЖИМОЕ (тикет 188) — на живом экране.
 *
 * Баг приёмки владельца 11.08 со снимками: «нельзя прокрутить вниз (баг) на
 * мобильном представлении» — в пустой комнате ряд чипов срезан нижним баром,
 * второго ряда не видно вовсе, прокрутить нечего. Причина была не в баре:
 * экран `.imm` ровно в высоту окна и с `overflow: hidden` (сцена, а не
 * страница), а полоса под кадром была ФИКСИРОВАННОЙ ВЫСОТЫ — лишнее срезалось
 * молча. Починка: потолок вместо высоты, своя прокрутка внутри слота, низ
 * полосы считается ОТ БАРА.
 *
 * ПРАВИЛА CSS СТЕРЕЖЁТ ЮНИТ (`tests/rail-overflow.test.ts`) — здесь
 * прямоугольники: правило легко остаётся в файле и перестаёт действовать.
 *
 * Меряется по очереди на двух размерах, названных в тикете, — 375×667 и
 * 375×812: на низком экране полосе остаётся меньше места, и обрезка вылезала
 * там первой.
 */
async function railKeepsItsContent(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await openRoom(page);

  const bar = await rectOf(page.locator(TAB_BAR), "таб-бар");
  const frameBefore = await rectOf(sceneFrame(page), "кадр комнаты");

  // ---- Настоящее содержимое стенда: ничего не подложено ----
  // Указатель зон длиннее полосы (тринадцать строк по 52 против ~500 px), и
  // последняя строка обязана доставаться целиком, а не «доскроллиться и
  // упереться в бар».
  const rows = page.locator(`${ZONE_INDEX} button`);
  const total = await rows.count();
  expect(total, "в указателе зон нет строк — комната стенда пуста?").toBeGreaterThan(0);
  const lastRow = rows.nth(total - 1);
  await lastRow.scrollIntoViewIfNeeded();
  const lastRowRect = await rectOf(lastRow, "последняя строка указателя зон");
  expect(
    lastRowRect.bottom,
    `последняя строка указателя ушла под таб-бар: низ ${lastRowRect.bottom.toFixed(1)}, верх бара ${bar.top.toFixed(1)}`,
  ).toBeLessThanOrEqual(bar.top + PX);
  expect(
    lastRowRect.top,
    `последняя строка указателя заехала на кадр: верх ${lastRowRect.top.toFixed(1)} при нижней кромке кадра ${frameBefore.bottom.toFixed(1)}`,
  ).toBeGreaterThanOrEqual(frameBefore.bottom - PX);

  // ---- Тот самый «следующий длинный текст» ----
  const slot = await growRailSlot(page, await railSlotClass(page));
  await expect(slot, "слот полосы не появился").toBeVisible();

  const rail = await rectOf(bottomSurface(page), "полоса под кадром");
  const frameAfter = await rectOf(sceneFrame(page), "кадр после наполнения полосы");

  // ПУНКТ 4 ТИКЕТА: полоса не наехала на комнату — кадр стоит там же, где стоял.
  expectSame(frameAfter.bottom, frameBefore.bottom, "нижняя кромка кадра до и после");
  // ПРАВИЛО 1: щели под кадром нет и с выросшей полосой.
  expectSame(rail.top, frameAfter.bottom, "верх полосы против нижней кромки кадра");
  // ПУНКТ 3: низ полосы считается ОТ БАРА, а не от края экрана.
  expectSame(rail.bottom, bar.top, "низ полосы против верха таб-бара");

  // ПУНКТ 1: у слота ПОТОЛОК, а не рост. До тикета он рос как хотел, и всё,
  // что не влезло в полосу, срезал `overflow: hidden` экрана — ровно тот баг.
  const slotBox = await rectOf(slot, "слот полосы");
  expect(
    slotBox.bottom,
    `слот полосы вырос ниже её низа: ${slotBox.bottom.toFixed(1)} при низе полосы ${rail.bottom.toFixed(1)} и верхе бара ${bar.top.toFixed(1)}`,
  ).toBeLessThanOrEqual(rail.bottom + PX);

  // ПУНКТ 2: длинное содержимое прокручивается ВНУТРИ слота. Прокрутка
  // нулевой длины значила бы, что не влезшее срезано молча — ровно тот баг.
  const scroll = await slot.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
    };
  });
  expect(
    scroll.scrollHeight,
    `слот полосы не переполнился — длинного текста не хватило: ${scroll.scrollHeight} при окне ${scroll.clientHeight}`,
  ).toBeGreaterThan(scroll.clientHeight);
  expect(
    scroll.scrollTop,
    "слот полосы не прокручивается: всё, что не влезло, срезано молча",
  ).toBeGreaterThan(0);

  // ГЛАВНОЕ ОБЕЩАНИЕ ТИКЕТА: последний узел доступен ЦЕЛИКОМ — не под баром и
  // не за кромками полосы.
  const slotRect = await rectOf(slot, "слот полосы после прокрутки");
  const tailRect = await rectOf(page.locator(`[data-e2e-line="${LONG_LINES - 1}"]`), "последний узел полосы");

  report(`полоса под кадром ${width}×${height}`, {
    кадр: `0…${frameAfter.bottom.toFixed(1)}`,
    полоса: `${rail.top.toFixed(1)}…${rail.bottom.toFixed(1)}`,
    бар: `${bar.top.toFixed(1)}…${bar.bottom.toFixed(1)}`,
    слот: `${slotRect.top.toFixed(1)}…${slotRect.bottom.toFixed(1)}`,
    "прокрутка слота": `${scroll.scrollTop}/${scroll.scrollHeight - scroll.clientHeight}`,
    "последний узел": `${tailRect.top.toFixed(1)}…${tailRect.bottom.toFixed(1)}`,
    "последняя строка указателя": `${lastRowRect.top.toFixed(1)}…${lastRowRect.bottom.toFixed(1)}`,
  });

  expect(tailRect.height, "последний узел полосы нулевой высоты").toBeGreaterThan(0);
  expect(
    tailRect.bottom,
    `последний узел полосы заходит под таб-бар: низ ${tailRect.bottom.toFixed(1)}, верх бара ${bar.top.toFixed(1)}`,
  ).toBeLessThanOrEqual(bar.top + PX);
  expect(
    tailRect.bottom,
    `последний узел срезан нижней кромкой полосы: низ ${tailRect.bottom.toFixed(1)} при низе слота ${slotRect.bottom.toFixed(1)}`,
  ).toBeLessThanOrEqual(slotRect.bottom + PX);
  expect(
    tailRect.top,
    `последний узел срезан верхней кромкой полосы: верх ${tailRect.top.toFixed(1)} при верхе слота ${slotRect.top.toFixed(1)}`,
  ).toBeGreaterThanOrEqual(slotRect.top - PX);

  // …и прокрутка полосы не утащила за собой сцену: комната остаётся на месте,
  // страница не листается вовсе (`.imm` — сцена, а не страница).
  expect(
    await page.evaluate(() => document.documentElement.scrollTop),
    "страница поехала за прокруткой полосы",
  ).toBe(0);
  const frameScrolled = await rectOf(sceneFrame(page), "кадр после прокрутки полосы");
  expectSame(frameScrolled.bottom, frameBefore.bottom, "нижняя кромка кадра после прокрутки полосы");

  await expectNoSideScroll(page, `полоса под кадром ${width}×${height}`);
}

test("полоса под кадром 375×667: длинный текст прокручивается, а не срезается баром", async ({
  page,
}) => {
  await railKeepsItsContent(page, 375, 667);
});

test("полоса под кадром 375×812: длинный текст прокручивается, а не срезается баром", async ({
  page,
}) => {
  await railKeepsItsContent(page, 375, 812);
});

// ---------- Тикет 190: первое действие пустой комнаты ----------

/**
 * ПУСТАЯ КОМНАТА — ЖИВАЯ, А НЕ ПОДРИСОВАННАЯ (тикет 190).
 *
 * Приёмка владельца 11.08: «на самом первом экране вставить ссылку из магазина
 * — лишняя активность, там нужна просто кнопка добавить свою первую вещь».
 * Слово и адрес стерегут юниты (`tests/empty-room-first-screen.test.ts`,
 * `tests/no-bulk-fill.test.ts`), но «нажал — и оказался в форме» юнит сказать
 * не может: там нет ни вёрстки, ни навигации.
 *
 * Раньше этот шаг был невозможен: комната стенда полна, блок первого шага живёт
 * под `itemCount === 0`, а опустошал стенд только разрушительный `?fresh=1`.
 * Теперь пустая комната у стенда СВОЯ, отдельным пользователем, и достаётся она
 * чтением — правило файла целое.
 *
 * Подрисовывать кнопку по-прежнему нельзя и не нужно: здесь всё до последнего
 * узла рисует продукт, тест только нажимает и смотрит, куда попал.
 */
test("пустая комната: единственное действие ведёт в нашу же форму /room/add", async ({ page }) => {
  await signInEmpty(page);
  await page.goto("/room");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // КОМНАТА ДЕЙСТВИТЕЛЬНО ПУСТА. Без этого шаг проверял бы пустоту разметки и
  // молча зеленел: блок первого шага рисуется только при `itemCount === 0`.
  const start = page.locator("main.imm .imm-empty-start");
  await expect(
    start,
    "блока первого шага нет — комната второго пользователя стенда перестала быть пустой (в ней завели вещь) либо вход ушёл не в ту комнату",
  ).toBeVisible();

  // ДЕЙСТВИЕ ОДНО (тикеты 137 и 191): «Или начни с готового» отсюда выпилено
  // навсегда, второй полосы света в блоке нет и быть не должно.
  const actions = start.getByRole("link");
  await expect(actions, "в блоке первого шага должно быть ровно одно действие").toHaveCount(1);

  const cta = actions.first();
  const label = (await cta.innerText()).trim();
  const href = await cta.getAttribute("href");

  // ГЕОМЕТРИЯ ЗАОДНО (тикет 188 на настоящем содержимом, а не на подложенном):
  // блок первого шага стоит между кадром и баром и не срезан ни тем, ни другим.
  const frame = await rectOf(sceneFrame(page), "кадр комнаты");
  const bar = await rectOf(page.locator(TAB_BAR), "таб-бар");
  const block = await rectOf(start, "блок первого шага");

  report("пустая комната", {
    кадр: `0…${frame.bottom.toFixed(1)}`,
    "блок первого шага": `${block.top.toFixed(1)}…${block.bottom.toFixed(1)}`,
    бар: `${bar.top.toFixed(1)}…${bar.bottom.toFixed(1)}`,
    действие: label,
    адрес: href ?? "",
  });

  expect(
    block.bottom,
    `блок первого шага заходит под таб-бар: низ ${block.bottom.toFixed(1)}, верх бара ${bar.top.toFixed(1)}`,
  ).toBeLessThanOrEqual(bar.top + PX);
  expect(
    block.top,
    `блок первого шага заехал на кадр: верх ${block.top.toFixed(1)} при нижней кромке кадра ${frame.bottom.toFixed(1)}`,
  ).toBeGreaterThanOrEqual(frame.bottom - PX);

  // ГЛАВНОЕ ОБЕЩАНИЕ ТИКЕТА. Нажимаем, а не читаем href: адрес мог бы быть
  // верным, а нажатие — перехваченным чужим слоем, и человек никуда бы не ушёл.
  await cta.click();
  await expect(
    page,
    `первое действие пустой комнаты («${label}», href ${href}) не привело в форму добавления`,
  ).toHaveURL(/\/room\/add$/);

  // …и это НАША форма, а не чужой магазин: на ней есть поле и кнопка сохранения.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.locator("form").getByRole("button").and(page.locator('[type="submit"]')),
    "в форме добавления нет кнопки сохранения — это не наш экран",
  ).toBeVisible();

  await expectNoSideScroll(page, "пустая комната");
});

// ---------- Тикет 199: приглашение делает СЦЕНА, а не кнопка ----------

/**
 * БЛОК ПЕРВОГО ШАГА ПОМЕЩАЕТСЯ ЦЕЛИКОМ — и это про пиксели, а не про разметку.
 *
 * Пакет 44 (`empty-room.json`) положил в блок надстрочную «комната обставляется
 * · N мест» и посчитал, что запаса останется 78 px. Считал он от кромки кадра с
 * отступом 22; у нас над блоком стоят 72 — отступ стопки 10 + строка действий 44
 * + шаг 4 + отступ слота 14. Первый же замер на 390×664 (телефон приёмки)
 * показал цену расхождения: слоту оставалось 190.8 px при 197.4 нужных, и
 * срезались ровно те 2 px, которыми полоса света и светит. Юнит этого не видит —
 * там нет ни кадра, ни бара, ни высоты строки.
 *
 * ЧТО ИМЕННО МЕРЯЕТСЯ. Не «блок выше бара» (этого мало: слот со своей
 * прокруткой уводит хвост под собственную кромку молча), а три вещи разом:
 * последний узел выше бара, слот НЕ переполнен (последняя строка видна без
 * прокрутки), и обещание стоит В КАДРЕ, а не в полосе вместе с блоком.
 *
 * ТИКЕТ 208 УВЁЛ ОБЕЩАНИЕ В КАДР, и полоса вернула себе зазор, который под него
 * держала (25 px строки действий). Прежняя проверка «блок не наехал на пилюлю
 * сверху» сменилась на проверку самого переезда: низ пилюли выше нижней кромки
 * кадра. Первая теперь верна сама собой и доказывала бы пустоту.
 */
async function emptyBlockFits(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await signInEmpty(page);
  await page.goto("/room");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const block = page.locator("main.imm .imm-empty-start");
  await expect(
    block,
    "блока первого шага нет — комната второго пользователя стенда перестала быть пустой",
  ).toBeVisible();

  const frame = await rectOf(sceneFrame(page), "кадр комнаты");
  const bar = await rectOf(page.locator(TAB_BAR), "таб-бар");
  const blockBox = await rectOf(block, "блок первого шага");
  const cta = await rectOf(block.getByRole("link"), "полоса света");
  const overline = block.locator(".imm-empty-places");
  await expect(overline, "надстрочной «комната обставляется · N мест» нет").toBeVisible();
  const pill = await rectOf(page.locator('[class*="promisePill"]'), "подпись-обещание");
  // «Коснись зоны» в пустой комнате не рисуется вовсе: касаться нечего, и её
  // место в жёлобе занял переехавший блок первого шага.
  await expect(
    page.locator('[class*="hintPill"]'),
    "в пустой комнате вернулась подсказка «коснись зоны»",
  ).toHaveCount(0);

  // ЖИВОЕ ЧИСЛО МЕСТ, а не 13 константой: надстрочная называет ровно столько,
  // сколько мест нарисовано в кадре ЭТОЙ комнаты. Юнит стережёт, что число
  // считается `visibleZones`; здесь оно сверяется с тем, что видно глазами.
  const overlineText = (await overline.innerText()).trim();
  const number = Number(/(\d+)/u.exec(overlineText)?.[1] ?? "0");
  const places = await page.locator('main.imm [class*="__zoneLabel"]').count();
  expect(
    number,
    `надстрочная говорит «${overlineText}», а мест в кадре ${places} — число перестало быть живым`,
  ).toBe(places);

  // ПОСЛЕ КНОПКИ НЕ СТОИТ НИЧЕГО (правило пакета): полоса света — последний
  // узел блока, и действие в нём ровно одно.
  await expect(block.getByRole("link"), "в блоке первого шага не одно действие").toHaveCount(1);
  const lastIsCta = await block.evaluate(
    (el) => el.lastElementChild?.classList.contains("imm-empty-cta") ?? false,
  );
  expect(lastIsCta, "после полосы света в блоке появился ещё один узел").toBe(true);

  // СЛОТ НЕ ПЕРЕПОЛНЕН: последняя строка видна без прокрутки. Прокрутка здесь
  // законна (тикет 188) и потому опасна — она прячет хвост молча, без полосы.
  const slot = await page.evaluate(() => {
    const el = document.querySelector("main.imm .imm-rail-bottom > div > :last-child");
    if (!el) return null;
    return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  expect(slot, "слота полосы нет").not.toBeNull();

  report(`пустая комната ${width}×${height}`, {
    кадр: `0…${frame.bottom.toFixed(1)}`,
    "подпись-обещание": `${pill.top.toFixed(1)}…${pill.bottom.toFixed(1)}`,
    блок: `${blockBox.top.toFixed(1)}…${blockBox.bottom.toFixed(1)}`,
    "полоса света": `${cta.top.toFixed(1)}…${cta.bottom.toFixed(1)}`,
    бар: `${bar.top.toFixed(1)}…${bar.bottom.toFixed(1)}`,
    слот: `${slot?.scrollHeight}/${slot?.clientHeight}`,
    "запас до бара": (bar.top - blockBox.bottom).toFixed(1),
    "над блоком от кромки кадра": (blockBox.top - frame.bottom).toFixed(1),
    "обещание над кромкой кадра": (frame.bottom - pill.bottom).toFixed(1),
    мест: String(places),
  });

  expect(
    (slot?.scrollHeight ?? 0) - (slot?.clientHeight ?? 0),
    `слот полосы переполнен на ${(slot?.scrollHeight ?? 0) - (slot?.clientHeight ?? 0)} px — хвост блока достаётся только прокруткой`,
  ).toBeLessThanOrEqual(PX);
  expect(
    cta.bottom,
    `полоса света заходит под таб-бар: низ ${cta.bottom.toFixed(1)}, верх бара ${bar.top.toFixed(1)}`,
  ).toBeLessThanOrEqual(bar.top + PX);
  // ОБЕЩАНИЕ — В КАДРЕ (тикет 208): «оно обещание про комнату, а в полосе под
  // ним становится подписью к кнопке». Проверяется прямоугольником, а не
  // деревом: узел может лежать внутри кадра в разметке и стоять под ним на
  // экране — ровно так он и жил до переезда.
  expect(
    pill.bottom,
    `обещание вышло из кадра: низ ${pill.bottom.toFixed(1)} при нижней кромке кадра ${frame.bottom.toFixed(1)}`,
  ).toBeLessThanOrEqual(frame.bottom + PX);
  expect(
    blockBox.top,
    `блок заехал на кадр: верх ${blockBox.top.toFixed(1)} при нижней кромке кадра ${frame.bottom.toFixed(1)}`,
  ).toBeGreaterThanOrEqual(frame.bottom - PX);

  await expectNoSideScroll(page, `пустая комната ${width}×${height}`);
}

test("пустая комната 375×667: блок первого шага виден целиком", async ({ page }) => {
  await emptyBlockFits(page, 375, 667);
});

test("пустая комната 390×664: блок первого шага виден целиком", async ({ page }) => {
  await emptyBlockFits(page, 390, 664);
});

test("комната С ВЕЩАМИ: полоса не выросла и указатель зон стоит там же", async ({ page }) => {
  // Условие тикетов 188 и 199 слово в слово. Уборка 19 px в СТРОКЕ ДЕЙСТВИЙ
  // (тикет 199) сделана меткой `imm-row-bare`, и метка эта — только для пустой
  // комнаты: там в строке нет ни одной цели нажатия. В комнате с вещами строка
  // полна, её 44 px — настоящий палец, а указатель обязан стоять пиксель в
  // пиксель там же, где стоял.
  await page.setViewportSize({ width: 390, height: 664 });
  await openRoom(page);

  const rail = await rectOf(bottomSurface(page), "полоса под кадром");
  const frame = await rectOf(sceneFrame(page), "кадр комнаты");
  const row = await rectOf(page.locator("main.imm .imm-rail-bottom .imm-row"), "строка действий");
  const index = page.locator(ZONE_INDEX);
  const firstRow = await rectOf(index.locator("button").first(), "первая строка указателя зон");

  report("комната с вещами 390×664", {
    кадр: `0…${frame.bottom.toFixed(1)}`,
    полоса: `${rail.top.toFixed(1)}…${rail.bottom.toFixed(1)}`,
    "строка действий": `${row.top.toFixed(1)}…${row.bottom.toFixed(1)} (h ${row.height.toFixed(1)})`,
    "первая строка указателя": `${firstRow.top.toFixed(1)}…${firstRow.bottom.toFixed(1)}`,
  });

  expect(
    await page.locator("main.imm .imm-row-bare").count(),
    "метка пустой комнаты приехала в комнату с вещами — строка действий потеряла цель нажатия",
  ).toBe(0);
  expectSame(row.height, 44, "высота строки действий в комнате с вещами");
  expectSame(rail.top, frame.bottom, "верх полосы против нижней кромки кадра");
  expectSame(firstRow.top, rail.top + 58, "верх первой строки указателя зон");
});

test("настройки: кадр во всю ширину и держится, пока крутят обе ручки", async ({ page }) => {
  // ЗАЧЕМ ЗДЕСЬ. Тикет 181 завёл крупный кадр вместо шести плиток 110×56,
  // тикет 185 забрал из пакета 43 ширину во весь экран. Оба числа — про
  // телефон и только про него: на десктопе кадр ограничен 520 и в столбце с
  // полями. Проверять их в юните нечем — там нет вёрстки.
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const window = await page.evaluate(() => document.documentElement.clientWidth);
  const frame = await rectOf(page.locator("main img, main [class*='frame']").first(), "кадр комнаты");

  // ПРАВИЛО: кадр идёт во всю ширину окна. Поля столбца страницы (20 с каждой
  // стороны) забраны отрицательным отступом — «кадр целиком, он и есть
  // комната». До тикета 185 было 335.2 на 375.
  expectSame(frame.width, window, "ширина кадра");
  expectSame(frame.left, 0, "левая кромка кадра");

  // Пропорция — система кадра 630×351 (ADR-0006), а не 16:9 макета. На 375
  // это 208.9; шестнадцать девятых дали бы 210.9, и расхождение в 2 px есть
  // ровно расхождение пропорций.
  expectSame(frame.height, (window * 351) / 630, "высота кадра по пропорции 630/351");

  // ПРАВИЛО: кадр остаётся на виду, пока человек внутри блока «Интерьер +
  // Свет». Прокручиваем к НИЖНЕЙ ручке — цвету света — и требуем кадр на
  // экране: ради этого случая липкость и заведена.
  // Нижняя ручка — ПОСЛЕДНЕЕ положение цвета света, и с тикета 256 это «Белый»:
  // «свечной» упразднён (владелец не отличил его от тёплого на комнате), в ряду
  // осталось два положения. Проверка та же: доехать до последней ручки блока и
  // потребовать кадр на экране.
  const colorRow = page.getByRole("button", { name: "Белый" });
  await colorRow.scrollIntoViewIfNeeded();
  const knob = await rectOf(colorRow, "положение «Белый»");
  const stuck = await rectOf(page.locator("main img, main [class*='frame']").first(), "кадр после прокрутки");
  const viewport = await page.evaluate(() => document.documentElement.clientHeight);

  report("настройки", {
    окно: `${window}×${viewport}`,
    кадр: `${frame.width.toFixed(1)}×${frame.height.toFixed(1)}`,
    "кадр после прокрутки": `${stuck.top.toFixed(1)}…${stuck.bottom.toFixed(1)}`,
    "нижняя ручка": `${knob.top.toFixed(1)}…${knob.bottom.toFixed(1)}`,
    "цель нажатия": knob.height.toFixed(1),
  });

  expect(
    stuck.bottom,
    `кадр уехал за верх окна: низ ${stuck.bottom.toFixed(1)}`,
  ).toBeGreaterThan(0);
  expect(
    stuck.top,
    `кадр уехал за низ окна: верх ${stuck.top.toFixed(1)} при высоте ${viewport}`,
  ).toBeLessThan(viewport);

  // Цель нажатия — контракт (`rooms.json → hitTargetMin`), а не вкус.
  expect(knob.height, `цель нажатия ${knob.height.toFixed(1)} меньше 44`).toBeGreaterThanOrEqual(
    44 - PX,
  );

  await expectNoSideScroll(page, "настройки");
});

// ---------- Тикет 196: карточка вещи — экран чтения, и их два ----------

/**
 * КАРТОЧКА ВЕЩИ ЖИВЬЁМ. Тикет 196 закрыт юнитами, и они держат много: текст
 * модуля, размеры из контракта, отсутствие ключей в DTO. Чего юнит сказать не
 * может — три вещи, и все три здесь:
 *
 *   • ПОЛОСА СВЕТА — не строка в CSS, а ВЫЧИСЛЕННЫЙ стиль. Юнит читает файл
 *     `guest-card.module.css` и видит, что рецепта в нём нет; но полоса может
 *     приехать на экран откуда угодно — из `globals.css`, из чужого модуля, из
 *     `className` соседнего компонента. Здесь она ищется на живом экране: у
 *     хозяйки обязана найтись ровно одна, у гостя — ни одной;
 *   • ЦЕЛЬ НАЖАТИЯ — прямоугольник в браузере, а не число в контракте;
 *   • ДЕНЕЖНАЯ ТИШИНА — то, что НАПЕЧАТАНО, а не то, что лежит в данных
 *     (см. describe в конце файла).
 */

/** Рецепт «полосы света» (tokens.json → button.primary): 2 px акцентом + ореол. */
type LightBar = {
  tag: string;
  cls: string;
  text: string;
  border: number;
  color: string;
  shadow: string;
  height: number;
};

/**
 * Все полосы света на экране — по ВЫЧИСЛЕННОМУ стилю, а не по имени класса.
 * Имя переименуют, а рецепт останется: нижняя граница от 2 px и ореол под ней.
 */
async function lightBars(page: Page): Promise<LightBar[]> {
  return page.evaluate(() => {
    const out: LightBar[] = [];
    for (const el of Array.from(document.querySelectorAll("main, main *"))) {
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderBottomWidth) < 1.5) continue;
      if (cs.boxShadow === "none") continue;
      if (cs.borderBottomStyle !== "solid") continue;
      const box = el.getBoundingClientRect();
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute("class") ?? "",
        text: (el.textContent ?? "").trim().slice(0, 40),
        border: parseFloat(cs.borderBottomWidth),
        color: cs.borderBottomColor,
        shadow: cs.boxShadow,
        height: box.height,
      });
    }
    return out;
  });
}

/** Акцент комнаты (`--card-accent`) в том виде, в каком его вернёт браузер. */
async function accentRgb(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector("main");
    const hex = (root ? getComputedStyle(root).getPropertyValue("--card-accent") : "").trim();
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!m) return hex;
    return `rgb(${parseInt(m[1] as string, 16)}, ${parseInt(m[2] as string, 16)}, ${parseInt(m[3] as string, 16)})`;
  });
}

type HitTarget = { text: string; cls: string; width: number; height: number };

/**
 * ЦЕЛИ НАЖАТИЯ ТЕЛА КАРТОЧКИ. Считается прямоугольник САМОГО узла — пальцу
 * достаётся он, а не строка вокруг него.
 *
 * ШАПКА ЭКРАНА СЮДА НЕ ВХОДИТ, и это не поблажка: `header` — общая для экранов
 * полоса возврата (`.head` с `min-height: 44`), а не действие карточки; тихая
 * ссылка «К комнате» внутри неё живёт по правилам `btn-quiet` и к контракту
 * карточки (`round45 → scaling`: «цели нажатия 44 — абсолютные») отношения не
 * имеет. Меряем то, ради чего человек на эту карточку пришёл.
 */
async function cardTargets(page: Page): Promise<HitTarget[]> {
  return page.evaluate(() => {
    const out: HitTarget[] = [];
    const selector = "a, button, [role=button], input, select, summary";
    for (const el of Array.from(document.querySelectorAll(`main ${selector}`))) {
      if (el.closest("header")) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      out.push({
        text: (el.textContent ?? "").trim().slice(0, 40),
        cls: el.getAttribute("class") ?? "",
        width: box.width,
        height: box.height,
      });
    }
    return out;
  });
}

/** Открыть первую зону с вещами и вернуть адрес карточки первой её вещи. */
async function firstItemHref(sheet: Locator): Promise<string> {
  const tile = sheet.locator('a[href*="/i/"]').first();
  await expect(tile, "в листе зоны нет ни одной дороги в карточку вещи").toBeVisible();
  const href = await tile.getAttribute("href");
  expect(href, "у плитки нет адреса карточки").toBeTruthy();
  return href as string;
}

test("карточка вещи у ХОЗЯЙКИ: ровно одна полоса света, цели нажатия от 44", async ({ page }) => {
  await openRoom(page);
  const sheet = await openSeededZone(page);
  const href = await firstItemHref(sheet);

  await page.goto(href);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // ПОЛОСА СВЕТА У ХОЗЯЙКИ ЕСТЬ, И ОНА ОДНА (турн 22, contract → owner.order).
  // Эта половина проверки — ещё и контроль для гостевой: детектор ищет живой
  // рецепт, и если он перестанет находить полосу вообще, красной станет ЭТА
  // проверка, а не молча зелёной гостевая.
  const bars = await lightBars(page);
  const accent = await accentRgb(page);
  const targets = await cardTargets(page);
  const smallest = targets.reduce((a, b) => (a.height < b.height ? a : b));

  report("карточка хозяйки", {
    адрес: href,
    "полос света": bars.length,
    полоса: bars[0]?.text ?? "",
    акцент: accent,
    целей: targets.length,
    "самая низкая цель": `${smallest.text || smallest.cls.slice(0, 24)} ${smallest.height.toFixed(1)}`,
  });

  expect(
    bars.map((bar) => `${bar.tag}.${bar.cls} «${bar.text}»`),
    "полоса света у хозяйки должна быть ровно одна — главное действие",
  ).toHaveLength(1);
  const bar = bars[0] as LightBar;
  expect(bar.tag, "полосой света обязана быть кнопка, а не оформление").toBe("button");
  expect(bar.border, `граница полосы ${bar.border} вместо 2 px`).toBeGreaterThanOrEqual(2 - PX);
  expect(bar.color, `полоса горит не акцентом комнаты (${accent})`).toBe(accent);
  expect(bar.height, `цель полосы света ${bar.height.toFixed(1)} меньше 44`).toBeGreaterThanOrEqual(
    44 - PX,
  );

  // ЦЕЛИ НАЖАТИЯ — контракт (`round45 → scaling`: 44 не переносится, оно
  // абсолютное), и держать их обязана каждая: знаки в шапке карточки, огоньки
  // «насколько хочется», строка полки, главное действие.
  expect(targets.length, "у карточки хозяйки не нашлось ни одного действия").toBeGreaterThan(0);
  for (const target of targets) {
    expect(
      target.height,
      `цель «${target.text || target.cls}» ${target.height.toFixed(1)}×${target.width.toFixed(1)} ниже 44`,
    ).toBeGreaterThanOrEqual(44 - PX);
  }

  await expectNoSideScroll(page, "карточка вещи у хозяйки");
});

test("карточка вещи у ГОСТЯ: ни одной полосы света, главное действие одно — бирка", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings");
  const sharePath = (
    await page
      .getByText(/^\/r\//)
      .first()
      .textContent()
  )?.trim();
  expect(sharePath, "в настройках не нашёлся адрес комнаты").toBeTruthy();

  // Гость приходит БЕЗ сессии — иначе это была бы хозяйка на своей же ссылке.
  await page.context().clearCookies();
  await page.goto(sharePath as string);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const sheet = zoneSheet(page);
  const rows = page.locator(`${ZONE_INDEX} button`);
  await expect(rows.first(), "указателя зон у гостя нет — комната стенда пуста?").toBeVisible();
  const total = await rows.count();
  let opened = false;
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    if ((await row.innerText()).includes(EMPTY_ZONE_SUB)) continue;
    await openZoneRow(row, sheet);
    opened = true;
    break;
  }
  expect(opened, "в комнате гостя нет ни одной зоны с вещами").toBe(true);

  // Плитку берём ту, у которой бирка на месте: занятая вещь — отдельный случай
  // контракта (`guest.taken`), и бирки у неё нет ПО ПРАВИЛУ.
  const free = sheet.locator('li:has(button[class*="gift-tag"])').first();
  await expect(
    free,
    "в зоне нет ни одной свободной вещи — все забронированы? проверь стенд",
  ).toBeVisible();
  const href = await free.locator('a[href*="/i/"]').first().getAttribute("href");
  expect(href, "у свободной плитки нет адреса карточки").toBeTruthy();

  await page.goto(href as string);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const bars = await lightBars(page);
  const targets = await cardTargets(page);

  report("карточка гостя", {
    адрес: href ?? "",
    "полос света": bars.length,
    полосы: bars.map((bar) => `${bar.tag} «${bar.text}»`).join(" · "),
    целей: targets.length,
    цели: targets.map((t) => `${t.text || t.cls.slice(0, 18)}:${t.height.toFixed(0)}`).join(" · "),
  });

  // ГЛАВНОЕ ПРАВИЛО ЭКРАНА (contract → guest.tag.rule): «иначе главных
  // действий два». Полосы света нет ни одной — ни своей, ни приехавшей из
  // чужого модуля. Утверждение стоит ПЕРВЫМ: оно и есть смысл шага, и падать
  // должно оно, а не замер бирки следом за ним.
  expect(
    bars.map((bar) => `${bar.tag}.${bar.cls} «${bar.text}»`),
    "на гостевой карточке зажглась полоса света — главных действий стало два",
  ).toEqual([]);

  // …и действие ровно одно: бирка. Кнопка на этом экране должна быть ОДНА —
  // не «бирка есть», а «кроме неё нажимать нечего». Появись рядом вторая
  // (полоса света из чужого модуля, «Изменить» из хозяйкиной карточки) —
  // красным станет именно это число.
  const tag = page.locator('button[class*="gift-tag"]');
  const buttons = page.locator("main button");
  await expect(
    buttons,
    "в гостевой карточке должна быть ровно одна кнопка — бирка на нити",
  ).toHaveCount(1);
  await expect(buttons.first(), "единственная кнопка карточки — не бирка").toHaveClass(/gift-tag/u);
  expect(
    targets.filter((target) => target.cls.includes("gift-tag")),
    "бирка не попала в цели нажатия",
  ).toHaveLength(1);

  /**
   * РАЗМЕР БИРКИ МЕРЯЕТСЯ ДО ПОВОРОТА. `getBoundingClientRect()` возвращает
   * описанный прямоугольник, а бирка в покое наклонена на −3°: 124×44 после
   * поворота описываются прямоугольником шире и выше себя, и сверка с
   * контрактом краснела бы на живой,
   * правильно собранной бирке. Раскладка — `offsetWidth/Height`, наклон —
   * отдельным утверждением по описанному прямоугольнику.
   */
  const tagBody = tag.locator('span[class*="__body"]').first();
  await expect(tagBody, "тела бирки нет на экране").toBeVisible();
  const tagShape = await tagBody.evaluate((el) => {
    const node = el as HTMLElement;
    const box = node.getBoundingClientRect();
    return {
      w: node.offsetWidth,
      h: node.offsetHeight,
      boxW: box.width,
      boxH: box.height,
      transform: getComputedStyle(node).transform,
    };
  });

  report("бирка на нити", {
    бирка: `${tagShape.w}×${tagShape.h}`,
    "в наклоне": `${tagShape.boxW.toFixed(1)}×${tagShape.boxH.toFixed(1)}`,
    поворот: tagShape.transform,
  });

  // БИРКА — 124×44, А НЕ 218×66 (пакет 55, турн 61b → тикет 248: «бирка
  // одного размера и больше не тянется»; размер повторён в round56/tag-thread.md
  // как «под бирку 124 × 44»). Здесь до 16.08 стояли прежние числа: замер не
  // краснел с 14.08 только потому, что мобильный проект зависит от chromium и
  // при его падении не гонялся вовсе.
  // Тело, а не корень: над телом висит нить, и она не цель.
  expectSame(tagShape.w, 124, "ширина бирки");
  expectSame(tagShape.h, 44, "высота бирки");
  expect(tagShape.h, `цель бирки ${tagShape.h} меньше 44`).toBeGreaterThanOrEqual(44 - PX);
  // Наклон покоя −3° (contract → guest.tag.tilt) — живой, а не строкой в CSS:
  // повёрнутая бирка описана прямоугольником шире и выше себя самой.
  expect(tagShape.transform, "бирка не повёрнута — наклона покоя нет").not.toBe("none");
  expect(
    tagShape.boxW,
    `бирка стоит ровно: описанный прямоугольник ${tagShape.boxW.toFixed(1)} против ширины ${tagShape.w}`,
  ).toBeGreaterThan(tagShape.w);

  await expectNoSideScroll(page, "карточка вещи у гостя");
});

// ---------- Пакет 46: денежная тишина при скрытой цене ----------

/**
 * «ПРИ СКРЫТОЙ ЦЕНЕ ПРОДУКТ НЕ ПЕЧАТАЕТ НИ ОДНОГО ЧИСЛА ДЕНЕГ» (round46 →
 * leak.rule). Дыру нашёл дизайн в нашей же починке 195: путь к вещи мы гостю
 * вернули, а путь нёс число с собой — цены в строках магазинов.
 *
 * ЗАЧЕМ ЖИВЬЁМ, РАЗ ЕСТЬ ЮНИТ. Юнит смотрит в ДАННЫЕ (в гостевом DTO при
 * скрытой цене нет ключей `price`/`currency`) — и это правильная половина. Но
 * правило пакета сказано про ПЕЧАТЬ, а печатает экран: число может приехать из
 * разобранной ссылки, из подписи «от», из чужого компонента, которому DTO не
 * указ. Здесь проверяется напечатанное — текст экрана и разметка страницы.
 *
 * ПОЧЕМУ У ПРОВЕРКИ СВОЯ КОМНАТА. См. шапку файла: на стенде вещи со скрытой
 * ценой нет ни одной, а чтением её не сделать. Комната здесь СВОЯ — своя почта
 * с ярлыком прогона, свой `shareSlug`, две вещи-близнеца, отличающиеся ровно
 * одним полем (`priceVisibility`). Ни строки стенда она не трогает и снимается
 * целиком в `afterAll`.
 *
 * ДВЕ ВЕЩИ, А НЕ ОДНА, — чтобы проверка кусалась. Открытая цена показывает,
 * что искатель денег их НАХОДИТ: не будь её, «денег не нашлось» значило бы
 * «искать не умеем».
 */
test.describe("денежная тишина при скрытой цене (пакет 46)", () => {
  /** Цена обеих вещей — одна и та же, различие ровно в её видимости. */
  const PRICE = "14900";
  /** Как её печатает продукт: `Intl` ставит узкий неразрывный пробел. */
  const PRICE_DIGITS = /14[\s  ]*900/u;
  /** Любой денежный знак: своё число, разобранное, «от», «примерно» — любое. */
  const MONEY_MARK = /[₽$€]|\bRUB\b|руб/iu;
  const SHOP_DOMAIN = "goldapple.ru";

  const RUN = randomUUID().slice(0, 8);
  const SLUG = `mc${RUN}`;
  let userId = "";
  let openHref = "";
  let hiddenHref = "";

  test.beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `card@run-${RUN}.mobile-layout.test`,
        displayName: "Мила",
        room: { create: { preset: "cream", zoneSet: "F", shareSlug: SLUG } },
      },
      include: { room: true },
    });
    userId = user.id;
    const roomId = user.room?.id as string;
    const common = {
      roomId,
      zone: "jewelry",
      price: PRICE,
      currency: "RUB",
      note: "Ждала их два года",
      desire: 3,
    };
    const open = await prisma.item.create({
      data: {
        ...common,
        title: "Серьги-капли",
        priceVisibility: "ALL",
        url: `https://www.${SHOP_DOMAIN}/19000175823`,
        canonicalUrl: `https://www.${SHOP_DOMAIN}/19000175823`,
        domain: SHOP_DOMAIN,
      },
    });
    const hidden = await prisma.item.create({
      data: {
        ...common,
        title: "Кольцо тонкое",
        // ЕДИНСТВЕННОЕ РАЗЛИЧИЕ ДВУХ ВЕЩЕЙ. Цена та же, ссылка та же, заметка
        // та же — иначе разница на экране ничего бы не доказывала.
        priceVisibility: "NONE",
        url: `https://www.${SHOP_DOMAIN}/19000175824`,
        canonicalUrl: `https://www.${SHOP_DOMAIN}/19000175824`,
        domain: SHOP_DOMAIN,
      },
    });
    openHref = `/r/${SLUG}/i/${open.id}`;
    hiddenHref = `/r/${SLUG}/i/${hidden.id}`;
  });

  test.afterAll(async () => {
    // Пользователь тянет за собой комнату и вещи каскадом схемы.
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** Что НАПЕЧАТАНО: текст экрана и разметка страницы вместе с данными RSC. */
  async function printed(page: Page): Promise<{ text: string; html: string }> {
    const text = await page.locator("main").innerText();
    return { text, html: await page.content() };
  }

  test("цена открыта — число на экране; цена скрыта — ни одного числа денег", async ({ page }) => {
    // ---- Контроль: искатель денег их находит ----
    await page.goto(openHref);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const shown = await printed(page);

    report("цена открыта", {
      адрес: openHref,
      "денежный знак": String(MONEY_MARK.test(shown.text)),
      "число цены": String(PRICE_DIGITS.test(shown.text)),
      магазин: String(shown.text.includes(SHOP_DOMAIN)),
    });

    expect(shown.text, "у вещи с открытой ценой число обязано быть напечатано").toMatch(
      PRICE_DIGITS,
    );
    expect(shown.text, "…и со знаком валюты").toMatch(MONEY_MARK);
    expect(shown.text, "ссылка на магазин у открытой цены на месте").toContain(SHOP_DOMAIN);

    // ---- Правило: та же вещь со скрытой ценой ----
    await page.goto(hiddenHref);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const quiet = await printed(page);

    report("цена скрыта", {
      адрес: hiddenHref,
      "денежный знак": String(MONEY_MARK.test(quiet.text)),
      "число цены в тексте": String(PRICE_DIGITS.test(quiet.text)),
      "число цены в разметке": String(PRICE_DIGITS.test(quiet.html)),
      магазин: String(quiet.text.includes(SHOP_DOMAIN)),
    });

    expect(
      quiet.text,
      `при скрытой цене на экране напечатан денежный знак:\n${quiet.text}`,
    ).not.toMatch(MONEY_MARK);
    expect(quiet.text, "при скрытой цене на экране напечатано число цены").not.toMatch(
      PRICE_DIGITS,
    );
    // «Ни в разметке, ни в данных» (round46 → leak.howToTest): у страницы RSC
    // приезжает тем же документом, и число там значило бы, что оно доехало до
    // браузера — печатать его осталось делом одной строки вёрстки.
    expect(quiet.html, "число цены доехало до браузера в данных страницы").not.toMatch(
      PRICE_DIGITS,
    );

    // …и ПУТЬ при этом остался (тикет 195 + round46 → anchor): скрытая цена
    // прячет число, а не дорогу к вещи. Без этой половины «тишина» достигалась
    // бы удалением блока магазинов целиком.
    expect(quiet.text, "при скрытой цене пропала и дорога в магазин — починка 195 сломана").toContain(
      SHOP_DOMAIN,
    );

    await expectNoSideScroll(page, "гостевая карточка со скрытой ценой");
  });

  /**
   * ЦЕЛИ НАЖАТИЯ ГОСТЕВОЙ КАРТОЧКИ — ВКЛЮЧАЯ СТРОКУ МАГАЗИНА (тикет 203).
   *
   * У хозяйки такая проверка была с самого начала, у гостя — нет, и дыра
   * держалась не на недосмотре: **на стенде нет ни одной гостевой вещи со
   * ссылкой на магазин** (посев кладёт всё с открытой ценой и без адресов),
   * поэтому строка «где купить» в замер просто не попадала. Здесь она есть у
   * обеих вещей — фикстура этого раздела и есть тот единственный случай, где
   * её видно.
   *
   * Что поймали живым замером: обычная строка (`.sheet`) давала **39.6** при
   * контрактных 44 (`rooms.json → hitTargetMin`; пакет 45 называет число
   * абсолютным, пакет 46 повторяет его для строк магазина). Главная дверь при
   * скрытой цене при этом давала 52.4 — правило соблюдалось везде, кроме той
   * строки, которую с тех пор не трогали.
   *
   * Меряем ОБА вида: открытую цену (там обычная строка) и скрытую (там дверь).
   */
  test("цели нажатия гостевой карточки — все от 44, включая строку магазина", async ({ page }) => {
    for (const [what, href] of [
      ["открытая цена — обычная строка магазина", openHref],
      ["скрытая цена — главная дверь", hiddenHref],
    ] as const) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const targets = await cardTargets(page);
      const shop = targets.filter((target) => target.text.includes(SHOP_DOMAIN));
      const smallest = targets.reduce((a, b) => (a.height < b.height ? a : b));

      report(`цели гостевой карточки · ${what}`, {
        целей: targets.length,
        "строк магазина": shop.length,
        "магазин, высота": shop.map((row) => row.height.toFixed(1)).join(" · "),
        "самая низкая цель": `${smallest.text || smallest.cls.slice(0, 24)} ${smallest.height.toFixed(1)}`,
      });

      // Без этой проверки шаг зеленел бы и на карточке без магазина вовсе —
      // то есть доказывал бы пустоту (ровно та дыра, из-за которой 39.6
      // прожили до сегодня).
      expect(shop.length, `${what}: строки магазина нет в замере — проверять нечего`).toBeGreaterThan(
        0,
      );

      expect(targets.length, `${what}: у карточки не нашлось ни одного действия`).toBeGreaterThan(0);
      for (const target of targets) {
        expect(
          target.height,
          `${what}: цель «${target.text || target.cls}» ${target.height.toFixed(1)}×${target.width.toFixed(1)} ниже 44`,
        ).toBeGreaterThanOrEqual(44 - PX);
      }
    }
  });
});
