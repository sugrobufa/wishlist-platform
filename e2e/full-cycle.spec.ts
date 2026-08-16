// e2e happy path всего цикла дарения (тикет 15): хозяйка заводит комнату и
// вещи → гость тихо бронирует → хозяйка видит ТОЛЬКО счётчик → «праздник
// прошёл» → «Дошло» → зал славы + связь + письмо occasion-owner. Плюс
// перф-замер комнаты гостя (mobile-эмуляция) с бюджетом веса сцены.
//
// Стенд: свой dev-сервер (playwright.config.ts, порт e2e/env.ts), dev-БД.
// Письма и magic link'и перехватываются швом E2E_MAIL_FILE (src/server/mailer);
// «магазин» — внутрипроцессная фикстура парсера за флагом E2E_FIXTURE_SHOP
// (localhost для парсера закрыт SSRF-защитой BY DESIGN — Comments тикета 06).
// Очередь mail обрабатывает мини-воркер прямо в этом процессе (та же логика
// processMailJob, что в src/worker) — отдельный процесс воркера не нужен и
// его планировщики не трогают чужие комнаты dev-БД.
//
// Решение по связи (контракты тикетов 10/11): связь рождается ТОЛЬКО из
// брони с guestUserId, поэтому гость логинится ПЕРЕД бронью. Просмотр
// комнаты без регистрации (сцена, бирка, «нет цены люблю») проверяется до
// логина — тихая бронь как продукт остаётся доступной анониму (юниты 08).
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { devices, expect, test, type Page } from "@playwright/test";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import ru from "../messages/ru.json";
import { rooms as roomPresets } from "../src/config/design";
import { prisma } from "../src/server/db";
import { MAIL_QUEUE_NAME } from "../src/server/queues";
import { processMailJob } from "../src/worker/mail";
import { E2E_BASE_URL, E2E_MAIL_FILE } from "./env";

// Мини-воркер шлёт письма из ЭТОГО процесса — mailer должен видеть шов.
process.env.E2E_MAIL_FILE = E2E_MAIL_FILE;

/**
 * …И СОБИРАТЬ ССЫЛКИ ОТ АДРЕСА СТЕНДА (тикет 158).
 *
 * `webServer.env` в playwright.config.ts задаёт окружение ТОЛЬКО процессу Next
 * — до этого процесса оно не доезжает вовсе. А письма рендерит мини-воркер
 * ниже, то есть ЭТОТ процесс: без строки ссылка в письме собиралась от
 * `.env` (`APP_BASE_URL=http://localhost:3000`) и вела на ЧУЖОЙ dev-сервер,
 * который прогон трогать не должен (контракт тикета 15). Проверено прогоном:
 * pid процесса теста и `appUrl` в нём совпадали с `.env`, а сервер на :3100
 * в то же время отдавал свой og:image от :3100 — `.env` ничего не «перебивал»,
 * просто в этом процессе адрес никто не ставил.
 *
 * Присваивание, а не `??=`: E2E_BASE_URL — адрес стенда, и он главнее того,
 * что лежит в `.env` разработчика.
 */
process.env.APP_BASE_URL = E2E_BASE_URL;

const HOSTESS_EMAIL = "hostess-e2e@wishlist.local";
const GUEST_EMAIL = "guest-e2e@wishlist.local";
const GUEST_NAME = "Тайный Гость";
/**
 * Комната сценария. Имя стоит константой, потому что оно звучит в прогоне
 * трижды: плитка интерьера, заголовок комнаты и — через карту комнат — выбор
 * НАБОРА, в котором эта комната живёт (тикет 241: наборов два, «все десять»
 * упразднён решением владельца 14.08.2026).
 */
const BOLD_ROOM = "Дерзкая";
const LOVE_TITLE = "Пластинка для тихих вечеров";
// Название из фикстуры парсера ozon.html (tests/parser/fixtures.test.ts).
const WANT_TITLE = "Смартфон Samsung Galaxy S24 8/256 ГБ графитовый";
const SHOP_URL = "https://e2e-shop.test/product";
/** Бюджет первого экрана сцены гостя: документ + картинки ≤ 2 МБ (тикет 15). */
const SCENE_BYTES_BUDGET = 2 * 1024 * 1024;

// Оба теста файла делят состояние (slug комнаты) и порядок — строго serial.
test.describe.configure({ mode: "serial" });

/**
 * Хотспот зоны НА САМОЙ СЦЕНЕ.
 *
 * После тикета 34 к каждой зоне ведут две кнопки: хотспот на кадре и пункт
 * указателя зон в нижней полосе (`<nav>` «Зоны комнаты»). Обе законны — это
 * два способа подойти к одной полке, и на телефоне список вообще единственный
 * путь к зонам, которые не попали в окно кадра.
 *
 * Различает их порядковый номер: у пункта списка имя «01 Музыка — подойти
 * ближе», у хотспота — без номера. Поэтому `exact`: поиск по вхождению нашёл
 * бы обе. Здесь мы сознательно проверяем путь через сцену — тот, которым
 * человек пользуется, увидев комнату.
 */
function sceneHotspot(page: Page, zoneLabel: string) {
  return page.getByRole("button", { name: `${zoneLabel} — подойти ближе`, exact: true });
}

/**
 * Главная кнопка формы «добавить вещь».
 *
 * Тикет 110 раздал ей девятнадцать глаголов по зонам (`zones.json → cta`,
 * читается `zoneCta`): «Поставить на полку» у книг, «Повесить в гардероб» у
 * гардероба, «Поставить к пластинкам» у музыки. Прежнее «Поставить в комнату»
 * осталось только запасным словом словаря — для зоны, глагола которой в
 * контракте нет. Слово теперь принадлежит ЗОНЕ, а не экрану, и ждать его
 * нельзя: любой следующий тикет дизайна снова покрасит прогон в красный.
 *
 * Устойчивое здесь — роль и то, что кнопка отправки в форме ровно одна
 * (`type="submit"`; всё остальное в ней — `type="button"`). Проверка не
 * ослаблена: это по-прежнему ровно один видимый элемент (strict mode), и
 * нажатие обязано увести на страницу зоны. Что на кнопке стоит глагол ИМЕННО
 * своей зоны и что он есть у всех девятнадцати — дело юнита
 * `tests/zone-cta.test.ts`, а не прогона цикла дарения.
 */
function saveItemButton(page: Page) {
  return page.locator("form").getByRole("button").and(page.locator('[type="submit"]'));
}

let mailWorker: Worker | null = null;
let mailRedis: IORedis | null = null;
/** Слаг комнаты хозяйки — из UI /room; нужен и перф-тесту. */
let roomSlug = "";

// ---------- Почтовый файл (шов E2E_MAIL_FILE) ----------

type MailRecord = { kind?: string; to?: string; url?: string; subject?: string; text?: string };

function readMailRecords(): MailRecord[] {
  if (!existsSync(E2E_MAIL_FILE)) return [];
  return readFileSync(E2E_MAIL_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.parse(line) as MailRecord;
      } catch {
        return {};
      }
    });
}

function magicLinksTo(email: string): MailRecord[] {
  return readMailRecords().filter((r) => r.kind === "magic-link" && r.to === email);
}

/**
 * Ссылки перехваченных писем, ведущие НЕ на стенд (тикет 158).
 *
 * Смотрим оба вида записей: `url` у magic link (его собирает сам Next из
 * запроса) и текст письма (его собирает `appUrl` из окружения ТОГО процесса,
 * который письмо рендерит). Пока шва не было, второе тихо уезжало на
 * `http://localhost:3000` — адрес чужого dev-сервера, — и прогон оставался
 * зелёным: он проверял «кому» и «тема», а внутрь письма не заглядывал.
 */
function foreignMailLinks(): string[] {
  return readMailRecords()
    .flatMap((record) => [
      ...(record.url ? [record.url] : []),
      ...(String(record.text ?? "").match(/https?:\/\/\S+/g) ?? []),
    ])
    .filter((url) => !url.startsWith(E2E_BASE_URL));
}

/**
 * Вход по magic link: форма /signin → ссылка из E2E_MAIL_FILE → страница
 * подтверждения → кнопка «Войти» (тикет 19). Ссылку ждём «свежую» (записей
 * стало больше, чем до отправки формы).
 */
async function signInWithMagicLink(page: Page, email: string): Promise<void> {
  const seenBefore = magicLinksTo(email).length;

  await page.goto("/signin");
  await page.getByLabel("Твоя почта").fill(email);
  await page.getByRole("button", { name: "Прислать ссылку" }).click();
  // Роль-заголовок, не текст: анонсер маршрута Next дублирует тайтл страницы,
  // и текстовый селектор ловит два элемента (strict mode, тикет 56).
  await expect(page.getByRole("heading", { name: "Письмо ушло" })).toBeVisible();

  let magicUrl = "";
  await expect
    .poll(
      () => {
        const links = magicLinksTo(email);
        magicUrl = String(links.at(-1)?.url ?? "");
        return links.length;
      },
      { timeout: 20_000, message: `magic link для ${email} не появился в ${E2E_MAIL_FILE}` },
    )
    .toBeGreaterThan(seenBefore);

  // Ссылка ведёт на НАШУ страницу подтверждения: её GET не тратит токен.
  // Заходим дважды — эмуляция предзагрузки адресной строки Chrome и почтового
  // сканера, кликающего ссылку за человека: после обоих заходов вход обязан
  // остаться рабочим (тикет 19).
  await page.goto(magicUrl);
  await page.goto(magicUrl);
  await expect(page).toHaveURL(/\/signin\/confirm/);
  await expect(page.getByRole("heading", { name: "Дверь открыта" })).toBeVisible();

  // Токен расходуется только нажатием (обычная форма POST, без JS).
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/(room|onboarding)/);
  await expect(page).not.toHaveURL(/error/i);
  await expect(page).not.toHaveURL(/api\/auth/);
}

// ---------- Уборка dev-БД ----------

/**
 * Сносит обоих e2e-пользователей; каскад Prisma прибирает комнату, вещи,
 * брони, сессии и связи. Отдельно: OccasionSummary (FK-связи с Room нет —
 * каскад его не достаёт) и неиспользованные VerificationToken.
 */
async function cleanupE2eData(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: [HOSTESS_EMAIL, GUEST_EMAIL] } },
    select: { id: true, room: { select: { id: true } } },
  });
  const roomIds = users.flatMap((user) => (user.room ? [user.room.id] : []));
  if (roomIds.length > 0) {
    await prisma.occasionSummary.deleteMany({ where: { roomId: { in: roomIds } } });
  }
  await prisma.verificationToken.deleteMany({
    where: { identifier: { in: [HOSTESS_EMAIL, GUEST_EMAIL] } },
  });
  await prisma.user.deleteMany({ where: { email: { in: [HOSTESS_EMAIL, GUEST_EMAIL] } } });
}

test.beforeAll(async () => {
  // Чистый лист: файл писем прошлого прогона и следы упавшего прогона в БД.
  mkdirSync(path.dirname(E2E_MAIL_FILE), { recursive: true });
  rmSync(E2E_MAIL_FILE, { force: true });
  await cleanupE2eData();

  // Мини-воркер очереди mail: occasion-owner (и прочие письма) — настоящим
  // processMailJob; reminder-tick сознательно no-op (его окно дат в happy
  // path не проверяется, а чужие комнаты dev-БД трогать нельзя).
  mailRedis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  mailWorker = new Worker(
    MAIL_QUEUE_NAME,
    async (job) => {
      if (job.name === "reminder-tick") return { status: "skipped", reason: "e2e-ignored" };
      return processMailJob(job.name, job.data);
    },
    { connection: mailRedis, concurrency: 1 },
  );
});

test.afterAll(async () => {
  await mailWorker?.close();
  await mailRedis?.quit().catch(() => undefined);
  await cleanupE2eData();
  await prisma.$disconnect();
});

test("полный цикл дарения: хозяйка → гость → счётчик → «что подарили» → зал славы и связи", async ({
  browser,
}) => {
  test.setTimeout(420_000);

  const hostess = await browser.newContext();
  const hostessPage = await hostess.newPage();

  // ИНВАРИАНТ №1: до «что подарили» имя гостя не существует НИ в одном
  // ответе хозяйке. Копим тела всех текстовых ответов её страницы
  // (HTML, JSON, RSC-потоки) с самого входа и проверяем перед закрытием
  // праздника — дальше раскрытие легально.
  const hostessBodies: Array<{ url: string; body: string }> = [];
  /** Ответы, тело которых так и не доехало, — см. BODY_READ_MS ниже. */
  const unreadBodies: string[] = [];
  const bodyReads: Array<Promise<void>> = [];
  let sweeping = true;

  /**
   * Сколько ждём ТЕЛО одного ответа.
   *
   * Без потолка шаг однажды повис на 79 секунд и съел бюджет всего прогона.
   * Причина не в продукте: Next префетчит ссылки, навигация отменяет часть
   * RSC-запросов, и `response.text()` у отменённого ответа не резолвится
   * ВООБЩЕ — до закрытия страницы. Чем больше ссылок на экране, тем чаще это
   * случается; после того как стартовый набор вырос до 95 зёрен, повисло
   * сразу несколько.
   *
   * Проверку это не ослабляет, и вот почему: тело, которого не получил даже
   * браузер, хозяйка увидеть не могла. А чтобы «пропущенных» не стало тихо
   * много, их считают и держат под порогом ниже.
   */
  const BODY_READ_MS = 5_000;

  hostessPage.on("response", (response) => {
    if (!sweeping) return;
    const contentType = (response.headers()["content-type"] ?? "").toLowerCase();
    if (!/text\/html|application\/json|text\/plain|text\/x-component/.test(contentType)) return;
    const url = response.url();
    bodyReads.push(
      Promise.race([
        response.text().then((body) => {
          hostessBodies.push({ url, body });
        }),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            unreadBodies.push(url);
            resolve();
          }, BODY_READ_MS),
        ),
      ]).catch(() => undefined), // редиректы и оборванные ответы — без тела
    );
  });

  await test.step("хозяйка: / → signin → magic link из E2E_MAIL_FILE", async () => {
    await hostessPage.goto("/");
    await hostessPage.getByRole("link", { name: /войти/i }).click();
    await expect(hostessPage).toHaveURL(/\/signin/);
    await signInWithMagicLink(hostessPage, HOSTESS_EMAIL);
    // Вошедшую без комнаты лендинг сам уводит в онбординг.
    await hostessPage.goto("/");
    await hostessPage.waitForURL(/\/onboarding/);
  });

  await test.step("онбординг: набор «Женская» → «Дерзкая» → дата «пока не знаю»", async () => {
    // ОНБОРДИНГ СТАЛ ТРЁХШАГОВЫМ (тикет 134, письмо 33 · турн 40b): набор →
    // интерьер → дата. Шага «что чаще всего хочется» здесь БОЛЬШЕ НЕТ — вопрос
    // уехал в первое открытие «начни с готового», где ответ сразу виден в
    // подборке (`src/app/room/starter-pack.tsx`). Поэтому исчезли и заголовок
    // «Что чаще всего хочется?», и кнопка «Пропустить», которую этот прогон
    // жал третьим действием: пропуск теперь — просто листать дальше.
    //
    // НАБОРОВ ДВА, А НЕ ТРИ (тикет 241, решение владельца 14.08.2026: «пол
    // определяет дальнейший набор комнат навсегда, никакого смешения»). Здесь
    // жал «Всё вместе» — набор, которого в продукте больше НЕТ ВОВСЕ: снимок
    // страницы из упавшего прогона показывает ровно две плитки, «Женская» и
    // «Мужская». Отсюда и краснота с 14.08 — сценарий выбирал упразднённое, а
    // не «строка переименовалась».
    //
    // НАБОР ВЫБИРАЕТСЯ ПО ДАННЫМ, А НЕ ПО ИМЕНИ — тот же приём, которым
    // мобильный спек выбирает зону («прибитый гвоздями ключ сделал бы спек
    // ложно красным»). Сценарию нужна комната «Дерзкая»; в каком она наборе,
    // знает карта комнат, а не этот файл. Переедет пресет в другой набор —
    // прогон поедет за ним, а не встанет на семь минут.
    //
    // Имя плитки — из словаря и РЕГУЛЯРКОЙ: доступное имя склеено из трёх её
    // текстов («Женская» + описание + «6 комнат»), точное совпадение по строке
    // не сработает никогда.
    const boldPreset = roomPresets.find((preset) => preset.name === BOLD_ROOM);
    expect(boldPreset, `комната «${BOLD_ROOM}» пропала из карты комнат`).toBeDefined();
    const setLabel = ru.Onboarding[`setLabel${boldPreset!.sex}` as const];
    await hostessPage.getByRole("button", { name: new RegExp(setLabel) }).click();
    await hostessPage.getByRole("button", { name: new RegExp(BOLD_ROOM) }).click();
    await hostessPage.getByRole("button", { name: /Дальше/ }).click();
    // Третий, последний шаг — дата праздника (тикет 43). Дальше по сценарию
    // праздник закрывается ВРУЧНУЮ, поэтому здесь осознанный пропуск: комната
    // заводится без даты, как и до появления шага.
    // Заголовок и кнопка пропуска — тоже из словаря. Здесь стояло «Когда
    // праздник?», а шаг давно спрашивает «Когда твой день рождения?»: вторая
    // мина той же породы, что и плитка набора, и она ждала сразу за ней.
    await expect(
      hostessPage.getByRole("heading", { name: ru.Onboarding.occasionTitle }),
    ).toBeVisible();
    await expect(hostessPage.getByText("Шаг 3 из 3")).toBeVisible();
    await hostessPage
      .getByRole("button", { name: new RegExp(ru.Onboarding.occasionSkip) })
      .click();
    await hostessPage.waitForURL(/\/room$/);
    await expect(hostessPage.getByRole("heading", { name: BOLD_ROOM })).toBeVisible();
  });

  await test.step("вещь «уже моё» вручную — уезжает в сокровищницу, а не в зону", async () => {
    // ПЕРЕПИСАНО тикетом 124 (отмена «хочу/люблю», решение владельца 09.08).
    // Состояний у вещи больше нет, различие живёт в МЕСТЕ: комната — чего
    // хочется, сокровищница — что уже моё. Поэтому «уже моё» и не может
    // остаться в зоне: прежний шаг ждал `/room/zone/music`, а вещь по новой
    // модели правильно уезжает на витрину.
    // Вход В ВИТРИНУ — отдельный адрес `?hall=1` (тикет 89). Переключателя
    // «люблю \ хочу» на форме больше НЕТ: место решает то, откуда пришли, а
    // не вопрос человеку. Это и есть модель v2 на экране.
    await hostessPage.goto("/room/add?hall=1&zone=music");
    await hostessPage.getByLabel("Название").fill(LOVE_TITLE);
    await expect(hostessPage.getByLabel("Куда в комнате")).toHaveValue("music");
    await saveItemButton(hostessPage).click();
    await hostessPage.waitForURL(/\/room\/hall/);
    await expect(hostessPage.getByText(LOVE_TITLE)).toBeVisible();

    // И в зоне её нет: место одно, показывается вещь ровно там, где лежит.
    await hostessPage.goto("/room/zone/music");
    await expect(hostessPage.getByRole("heading", { name: "Музыка" })).toBeVisible();
    await expect(hostessPage.getByText(LOVE_TITLE)).toHaveCount(0);
  });

  await test.step("вещь «хочу» по ссылке фикстурного магазина: предзаполнение и цена", async () => {
    // Без ?hall — вещь идёт в КОМНАТУ, вопроса о состоянии не задаётся.
    await hostessPage.goto("/room/add?zone=music");
    await hostessPage.locator('input[type="url"]').fill(SHOP_URL);
    await hostessPage.getByRole("button", { name: "Заполнить по ссылке" }).click();

    // Предзаполнение из фикстуры: название, цена и валюта видны и редактируемы.
    await expect(hostessPage.getByLabel("Название")).toHaveValue(WANT_TITLE, {
      timeout: 20_000,
    });
    await expect(hostessPage.getByLabel("Цена")).toHaveValue("74990");
    await expect(hostessPage.getByLabel("Валюта")).toHaveValue("RUB");

    // Фото магазина не сохраняем: воркер image.ingest не пойдёт в сеть за
    // выдуманным CDN-адресом фикстуры.
    await hostessPage.getByRole("button", { name: "Не сохранять" }).click();

    await saveItemButton(hostessPage).click();
    await hostessPage.waitForURL(/\/room\/zone\/music/);
    // Вкладок нет с тикета 88 — зона показывает все вещи строками сразу.
    await expect(hostessPage.getByText(WANT_TITLE)).toBeVisible();
    await expect(hostessPage.getByText(/74\s?990/)).toBeVisible();
  });

  await test.step("адрес комнаты читается из UI", async () => {
    // Тикет 24 убрал карточку с адресом из комнаты: на экране остался значок
    // «поделиться», а сам адрес живёт в настройках, рядом с ником.
    await hostessPage.goto("/settings");
    const sharePath =
      (
        await hostessPage
          .getByText(/^\/r\//)
          .first()
          .textContent()
      )?.trim() ?? "";
    roomSlug = sharePath.replace("/r/", "");
    expect(roomSlug).not.toBe("");
  });

  // Вещь КОМНАТЫ (тикет 124): состояний больше нет, бронируется всё, что не
  // уехало в сокровищницу. Прогон целиком — работа отдельного захода.
  const wantItem = await prisma.item.findFirstOrThrow({
    where: { inHall: false, room: { user: { email: HOSTESS_EMAIL } } },
    select: { id: true },
  });

  await test.step("негатив: хозяйка не может забронировать свою вещь (403 OWN_ITEM)", async () => {
    const response = await hostessPage.request.post(`/api/v1/items/${wantItem.id}/book`, {
      data: { name: "Хозяйка", mode: "QUIET" },
    });
    expect(response.status()).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("OWN_ITEM");
  });

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();

  await test.step("гость без сессии: сцена, вещь «хочу» с биркой, у «люблю» нет цены", async () => {
    await guestPage.goto(`/r/${roomSlug}`);
    await expect(guestPage.getByRole("heading", { name: "Хозяйка комнаты" })).toBeVisible();

    // Приветствие холодного гостя (тикет 38, турн 12b). Свободен ровно один
    // подарок — единственная вещь «хочу» этой комнаты, и её ещё никто не
    // занял. Дата праздника у комнаты не задана («Пока не знаю» в онбординге),
    // поэтому строки отсчёта быть не должно.
    await expect(guestPage.getByText("1 подарок ещё свободен")).toBeVisible();
    await expect(guestPage.getByText(/Регистрация не нужна/)).toBeVisible();
    await expect(guestPage.getByText(/Праздник через/)).toHaveCount(0);

    await sceneHotspot(guestPage, "Музыка").click();
    // Вкладки состояний сняты тикетом 124: панель зоны показывает один список.
    const wantTile = guestPage.locator("li", { hasText: WANT_TITLE });
    await expect(wantTile).toBeVisible();
    await expect(wantTile).toContainText(/74\s?990/); // цена «хочу» при видимости «все»
    await expect(wantTile.getByRole("button", { name: /Подарить$/ })).toBeVisible();

    // ПЕРЕПИСАНО тикетом 124. Вкладок «Хочу/Люблю» больше нет — делить нечем,
    // и проверять теперь надо не подпись, а МЕСТО: вещь «уже моё» в зоне у
    // гостя не показывается вовсе, она живёт на витрине.
    await expect(guestPage.getByText(LOVE_TITLE)).toHaveCount(0);
  });

  await test.step("гость видит витрину — и ни одной цены на ней (инвариант №8)", async () => {
    await guestPage.goto(`/r/${roomSlug}/hall`);
    const shelfItem = guestPage.getByText(LOVE_TITLE);
    await expect(shelfItem).toBeVisible();
    // Цена в сокровищнице гостю не показывается вовсе — не по настройке, а
    // по устройству модели v2: витрина рассказывает о человеке, а не торгует.
    const hall = guestPage.locator("main");
    await expect(hall).not.toContainText("₽");
    await expect(hall).not.toContainText(/\d{3}\s?\d{3}/);
  });

  await test.step("негатив: /r/nonexistent → 404", async () => {
    const response = await guestPage.goto("/r/nonexistent");
    expect(response?.status()).toBe(404);
  });

  await test.step("гость логинится (иначе связь не родится) и визитом создаёт «смотрели»", async () => {
    await signInWithMagicLink(guestPage, GUEST_EMAIL);

    const visitPing = guestPage.waitForResponse(
      (response) => response.url().includes("/visit") && response.request().method() === "POST",
    );
    await guestPage.goto(`/r/${roomSlug}`);
    expect((await visitPing).status()).toBe(204);

    // У хозяйки появилась связь «смотрели» — без имени брони, просто визит.
    await hostessPage.goto("/connections");
    const viewedRow = hostessPage.locator("li", { hasText: "Гость без имени" });
    await expect(viewedRow).toContainText("Заходил");
  });

  await test.step("гость тихо бронирует: «уже даришь ты» и «Мои подарки · 1»", async () => {
    await sceneHotspot(guestPage, "Музыка").click();
    // Вкладок состояний нет (тикет 124) — бирка «Подарить» видна сразу.
    await guestPage.getByRole("button", { name: /Подарить$/ }).click();

    const dialog = guestPage.getByRole("dialog");
    await dialog.getByLabel("Как тебя звать").fill(GUEST_NAME);
    await dialog.getByLabel(/Почта/).fill(GUEST_EMAIL);
    await dialog.getByRole("radio", { name: /^Тихо/ }).click();
    await dialog.getByRole("button", { name: /Подарить это/ }).click();

    await expect(guestPage.getByText("Вещь твоя. Никому не скажем")).toBeVisible();

    // Регистрация по пути (тикет 38, турн 12c): предложение появляется РОВНО
    // ЗДЕСЬ — сразу после доброго дела — и почта в нём уже своя, из брони.
    // «Потом» ничего не блокирует: бронь остаётся, лист остаётся открытым.
    await expect(dialog.getByText("А когда твой день рождения?")).toBeVisible();
    await expect(dialog.getByLabel("Почта", { exact: true })).toHaveValue(GUEST_EMAIL);
    await dialog.getByRole("button", { name: "Потом" }).click();
    await expect(dialog.getByText("А когда твой день рождения?")).toHaveCount(0);

    await guestPage.getByRole("button", { name: "Хорошо" }).click();
    // Тикет 105 (доска Б11) переписал обе подписи занятости: «занято» → «уже
    // дарят», «занято тобой» → «уже даришь ты» — речь о подарке, а не о складе
    // (разбор в tests/messages-tone.test.ts, OWNER_REWRITE_105). Смысл
    // проверки тот же: на плитке своей брони стоит подпись «моей» брони
    // (`Booking.takenByYou`), а не общее «уже дарят» и не бирка «Подарить».
    const bookedTile = guestPage.locator("li", { hasText: WANT_TITLE });
    await expect(bookedTile).toContainText("уже даришь ты");
    await expect(bookedTile.getByRole("button", { name: /Подарить$/ })).toHaveCount(0);
    await expect(guestPage.getByRole("link", { name: /Мои подарки · 1/ })).toBeVisible();
  });

  await test.step("отметка «уже спрашивали» пережила перезагрузку страницы", async () => {
    // Доска: «спрашиваем ровно один раз, сразу после того, как гость сделал
    // доброе дело». Само правило закрыто юнитами (ask-once.test.ts); здесь
    // проверяется, что отметка действительно легла в браузер и пережила
    // перезагрузку, — иначе на следующей броне мы спросим второй раз.
    await guestPage.reload();
    const asked = await guestPage.evaluate(() => window.localStorage.getItem("wl.room-offer.v1"));
    expect(asked).not.toBeNull();
  });

  await test.step("ИНВАРИАНТ: хозяйка видит только «1 вещь уже забрана», имени гостя нет нигде", async () => {
    await hostessPage.goto("/room");
    await expect(hostessPage.getByText("1 вещь уже забрали")).toBeVisible();

    // DOM текущей страницы…
    expect(await hostessPage.content()).not.toMatch(/Тайный|guest-e2e/);

    // …и ВСЕ network-ответы хозяйки за сессию (HTML, JSON, RSC): регекс по
    // телам. Дальше начинается «что подарили», где раскрытие легально, —
    // сбор останавливаем ровно здесь.
    await Promise.all(bodyReads);
    sweeping = false;
    expect(hostessBodies.length).toBeGreaterThan(10); // сбор действительно шёл
    // ЧЕСТНО ПРО ОХВАТ: тела читаются НЕ ВСЕ — примерно половина (20 из 42 на
    // сегодня). Playwright отдаёт тело документа, только пока страница с него
    // не ушла, а Next в дев-режиме стримит разметку; после навигации тело
    // недоступно ни ему, ни нам. Прочитанное — это RSC-потоки, JSON и те
    // документы, что успели закрыться: как раз то, где утечка выглядела бы
    // JSON-полем.
    //
    // Поэтому этот сбор — сеть, а не доказательство. Доказывают инвариант №1
    // юниты: `itemForOwner` без ключей брони (items.dto), канал «занято»
    // отдаёт хозяйке пустоту (owner-counter), сводка зоны не несёт «свободно»
    // (zone-summary.dto). Здесь мы ловим то, чего юнит не увидит: протечку
    // через новый, никем не покрытый ответ.
    expect(
      unreadBodies.length,
      `недочитанных тел стало больше прочитанных — сеть почти перестала ловить: ${unreadBodies.length} против ${hostessBodies.length}`,
    ).toBeLessThan(hostessBodies.length * 3);
    const leaked = hostessBodies.filter(({ body }) => /Тайный|guest-e2e/.test(body));
    expect(
      leaked.map(({ url }) => url),
      "имя гостя/его почта протекли хозяйке до «что подарили»",
    ).toEqual([]);
  });

  await test.step("итог вручную → строка с именем → «Дошло» → «уже в зале славы»", async () => {
    await hostessPage.goto("/room/occasion");
    // У комнаты сценария даты нет вовсе («Пока не знаю» в онбординге): экран в
    // состоянии «дня рождения нет» (тикет 216) — заголовок про дату, а ручное
    // закрытие стоит ТИХОЙ строкой, а не полосой света (тикет 217): гореть
    // между праздниками громкой кнопке владелец запретил. Слова состояний —
    // пакета 48 (тикет 219): «Дата ещё не названа» и «Праздник уже был —
    // открыть итог» («подвести» звучало как работа хозяйки, а здесь одно
    // нажатие).
    await expect(hostessPage.getByRole("heading", { name: "Дата ещё не названа" })).toBeVisible();
    await hostessPage.getByRole("button", { name: /открыть итог/ }).click();

    // Ручное закрытие работает без даты: появляется итог с раскрытым именем.
    await expect(hostessPage.getByText(`Подарок от ${GUEST_NAME}`)).toBeVisible({
      timeout: 20_000,
    });
    await hostessPage.getByRole("button", { name: "Дошло" }).click();
    await expect(hostessPage.getByText(`${GUEST_NAME} · уже в сокровищнице`)).toBeVisible({
      timeout: 20_000,
    });
    // Раздел «Связи» переименован в «Друзья» решением владельца (тикет 62).
    await expect(hostessPage.getByRole("link", { name: /Появился друг/ })).toBeVisible();
  });

  await test.step("зал славы: вещь на подиуме с подписью дарителя", async () => {
    await hostessPage.goto("/room/hall");
    await expect(hostessPage.getByText(WANT_TITLE)).toBeVisible();
    const year = new Date().getUTCFullYear();
    await expect(hostessPage.getByText(`Подарок ${year} года · от ${GUEST_NAME}`)).toBeVisible();
  });

  await test.step("связи: «Я слежу» (у гостя нет комнаты) с историей подарка", async () => {
    await hostessPage.goto("/connections");
    const row = hostessPage.locator("li", { hasText: "Гость без имени" });
    await expect(row).toContainText("Я слежу"); // FOLLOW: комната гостя не заведена
    await expect(row).toContainText("она в сокровищнице"); // происхождение из подарка
  });

  await test.step("письмо occasion-owner хозяйке лежит в E2E_MAIL_FILE", async () => {
    const occasionMail = (): MailRecord | undefined =>
      readMailRecords().find(
        (record) =>
          record.kind === "mail" &&
          record.to === HOSTESS_EMAIL &&
          (record.subject ?? "").includes("что подарили"),
      );

    await expect
      .poll(() => occasionMail() !== undefined, {
        timeout: 30_000,
        message: "письмо «открой „что подарили“» не дошло до файла",
      })
      .toBe(true);

    // ССЫЛКА ВЕДЁТ НА СТЕНД, А НЕ НА ЧУЖОЙ АДРЕС (тикет 158). До этой проверки
    // прогон был зелёным с `http://localhost:3000/room/occasion` в письме:
    // письма рендерит процесс ТЕСТА, а `webServer.env` задаёт окружение только
    // процессу Next. Проверяем именно перехваченное письмо — там же, где это
    // увидел владелец.
    expect(
      occasionMail()?.text ?? "",
      "ссылка письма собрана не от адреса e2e-стенда",
    ).toContain(`${E2E_BASE_URL}/room/occasion`);
    expect(foreignMailLinks(), "в письмах прогона есть ссылка на ЧУЖОЙ адрес").toEqual([]);
  });

  await guest.close();
  await hostess.close();
});

test("перф комнаты гостя (mobile-эмуляция): вес первого экрана и LCP", async ({ browser }) => {
  test.setTimeout(420_000);
  expect(roomSlug, "слаг комнаты из основного теста").not.toBe("");

  const context = await browser.newContext({ ...devices["iPhone 14"] });
  const page = await context.newPage();
  await page.goto(`/r/${roomSlug}`, { waitUntil: "load" });

  const metrics = await page.evaluate(async () => {
    // LCP через PerformanceObserver (buffered): берём последнюю запись после
    // паузы — на статичной странице она финальная.
    const lcpMs = await new Promise<number>((resolve) => {
      let last = 0;
      let observer: PerformanceObserver;
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) last = entry.startTime;
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        resolve(0);
        return;
      }
      setTimeout(() => {
        observer.disconnect();
        resolve(Math.round(last));
      }, 1_500);
    });

    const size = (entry: { transferSize: number; encodedBodySize: number }) =>
      entry.transferSize || entry.encodedBodySize || 0;
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

    const isImage = (entry: PerformanceResourceTiming) =>
      entry.initiatorType === "img" ||
      /\/rooms\//.test(entry.name) || // кадры сцены (background-image)
      /\.(jpe?g|png|webp|avif|gif|svg)(\?|$)/i.test(entry.name);

    const documentBytes = navigation ? size(navigation) : 0;
    return {
      lcpMs,
      documentBytes,
      imageBytes: resources.filter(isImage).reduce((sum, entry) => sum + size(entry), 0),
      totalBytes: documentBytes + resources.reduce((sum, entry) => sum + size(entry), 0),
      resourceCount: resources.length,
      domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : 0,
      loadMs: navigation ? Math.round(navigation.loadEventEnd) : 0,
    };
  });

  // Цифры — в отчёт (test-results и консоль); ассерт на LCP сознательно не
  // вешаем — на dev-сервере метрика плавает (см. Comments тикета 15).
  console.log(`[perf /r/${roomSlug}]`, JSON.stringify(metrics));
  await test.info().attach("guest-room-perf.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });

  // Бюджет тикета: первый экран СЦЕНЫ ≤ 2 МБ. Считаем документ + картинки:
  // dev-бандлы JS не показательны для прода и в бюджет сцены не входят
  // (полный вес — в metrics.totalBytes отчёта).
  expect(metrics.documentBytes + metrics.imageBytes).toBeLessThanOrEqual(SCENE_BYTES_BUDGET);

  await context.close();
});
