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
// РАЗВЯЗКА С `full-cycle` — В КОНФИГЕ, а не здесь: проект `mobile` объявлен
// `dependencies: ["chromium"]` и идёт ПОСЛЕ десктопного, а не рядом с ним. Драка
// была бы не за строки, а за единственный dev-сервер: посев стенда и полный
// цикл дарения упирались бы в одну очередь компиляции Next.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ожиданий «на всякий случай»: спек, который висит по 15 секунд
// ради стабильности, съедает бюджет ночного прогона (так уже было — шаг висел
// 79 секунд). Анимации ждём не таймером, а `getAnimations()` того самого узла,
// который меряем.
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
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
});

/** Сессия стенда — в свежий контекст теста. Второго входа не бывает. */
async function signIn(page: Page): Promise<void> {
  expect(standSession, "сессия стенда не добыта — смотри падение beforeAll").not.toBeNull();
  await page.context().addCookies(standSession ?? []);
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

  // ПРАВИЛО 2, первая половина: бара в разметке НЕ СУЩЕСТВУЕТ. Гость не вошёл
  // — вкладкам некуда вести.
  await expect(
    page.locator(TAB_BAR),
    "у гостя не должно быть постоянного таб-бара",
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
    баров: 0,
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

/**
 * ТИКЕТА 190 ЗДЕСЬ НЕТ, И ЭТО НЕ ЗАБЫВЧИВОСТЬ.
 *
 * «Главное действие пустой комнаты ведёт в `/room/add`» — утверждение о ПУСТОЙ
 * комнате, а пустой комнаты у этого спека нет и быть не может. Комната стенда
 * полна (девять десятков вещей), и блок первого шага в ней не рисуется вовсе:
 * он живёт под условием `itemCount === 0` (src/app/room/page.tsx). Опустошить
 * её нечем, кроме `/dev-login?fresh=1`, а это СНОС комнаты стенда — запись, и
 * разрушительная; спек затевался читающим (шапка файла).
 *
 * Подрисовать кнопку самим здесь было бы не проверкой, а её имитацией: тест
 * мерил бы собственную разметку и сказал бы «сошлось» при любом продукте.
 * Длинный узел выше — другое дело: он не изображает поведение, а даёт полосе
 * то, чего у стенда нет, — длину; отвечает на неё сам продукт, своими стилями.
 *
 * Половину «слово и адрес» стерегут юниты — `tests/empty-room-first-screen.test.ts`
 * (в слоте пустой комнаты ровно один адрес, и это `/room/add`) и
 * `tests/no-bulk-fill.test.ts`. Половину «дорога ведёт в нашу же форму» —
 * шаг «карточка добавления» выше, он ходит по `/room/add` живьём.
 *
 * ЧТО НУЖНО, ЧТОБЫ ПРОВЕРИТЬ ЭТО ГЛАЗАМИ МАШИНЫ: у стенда должен появиться
 * ВТОРОЙ пользователь с заведомо пустой комнатой (посев, `prisma/seed.ts`), и
 * `/dev-login` должен уметь входить им. Тогда пустая комната достаётся чтением,
 * и правило файла остаётся целым.
 */

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
  const colorRow = page.getByRole("button", { name: "Свечной" });
  await colorRow.scrollIntoViewIfNeeded();
  const knob = await rectOf(colorRow, "положение «Свечной»");
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
