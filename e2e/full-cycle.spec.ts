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
import { prisma } from "../src/server/db";
import { MAIL_QUEUE_NAME } from "../src/server/queues";
import { processMailJob } from "../src/worker/mail";
import { E2E_MAIL_FILE } from "./env";

// Мини-воркер шлёт письма из ЭТОГО процесса — mailer должен видеть шов.
process.env.E2E_MAIL_FILE = E2E_MAIL_FILE;

const HOSTESS_EMAIL = "hostess-e2e@wishlist.local";
const GUEST_EMAIL = "guest-e2e@wishlist.local";
const GUEST_NAME = "Тайный Гость";
const LOVE_TITLE = "Пластинка для тихих вечеров";
// Название из фикстуры парсера ozon.html (tests/parser/fixtures.test.ts).
const WANT_TITLE = "Смартфон Samsung Galaxy S24 8/256 ГБ графитовый";
const SHOP_URL = "https://e2e-shop.test/product";
/** Бюджет первого экрана сцены гостя: документ + картинки ≤ 2 МБ (тикет 15). */
const SCENE_BYTES_BUDGET = 2 * 1024 * 1024;

// Оба теста файла делят состояние (slug комнаты) и порядок — строго serial.
test.describe.configure({ mode: "serial" });

let mailWorker: Worker | null = null;
let mailRedis: IORedis | null = null;
/** Слаг комнаты хозяйки — из UI /room; нужен и перф-тесту. */
let roomSlug = "";

// ---------- Почтовый файл (шов E2E_MAIL_FILE) ----------

type MailRecord = { kind?: string; to?: string; url?: string; subject?: string };

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
 * Вход по magic link: форма /signin → ссылка из E2E_MAIL_FILE → страница
 * подтверждения → кнопка «Войти» (тикет 19). Ссылку ждём «свежую» (записей
 * стало больше, чем до отправки формы).
 */
async function signInWithMagicLink(page: Page, email: string): Promise<void> {
  const seenBefore = magicLinksTo(email).length;

  await page.goto("/signin");
  await page.getByLabel("Ваша почта").fill(email);
  await page.getByRole("button", { name: "Прислать ссылку для входа" }).click();
  await expect(page.getByText("Ссылка отправлена")).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Вход в комнату" })).toBeVisible();

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
  const bodyReads: Array<Promise<void>> = [];
  let sweeping = true;
  hostessPage.on("response", (response) => {
    if (!sweeping) return;
    const contentType = (response.headers()["content-type"] ?? "").toLowerCase();
    if (!/text\/html|application\/json|text\/plain|text\/x-component/.test(contentType)) return;
    bodyReads.push(
      response
        .text()
        .then((body) => {
          hostessBodies.push({ url: response.url(), body });
        })
        .catch(() => undefined), // редиректы и оборванные ответы — без тела
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

  await test.step("онбординг: набор «Все 10» → комната «Дерзкая»", async () => {
    await hostessPage.getByRole("button", { name: /Все 10/ }).click();
    await hostessPage.getByRole("button", { name: /Дерзкая/ }).click();
    await hostessPage.getByRole("button", { name: /Обставить комнату/ }).click();
    await hostessPage.waitForURL(/\/room$/);
    await expect(hostessPage.getByRole("heading", { name: "Дерзкая" })).toBeVisible();
  });

  await test.step("вещь «люблю» вручную в зону музыки", async () => {
    await hostessPage.goto("/room/add?zone=music");
    await hostessPage.getByRole("button", { name: /Люблю/ }).click();
    await hostessPage.getByLabel("Название").fill(LOVE_TITLE);
    await expect(hostessPage.getByLabel("Куда в комнате")).toHaveValue("music");
    await hostessPage.getByRole("button", { name: /Поставить в комнату/ }).click();
    await hostessPage.waitForURL(/\/room\/zone\/music/);
    await expect(hostessPage.getByRole("tab", { name: /Люблю · 1/ })).toBeVisible();
    await expect(hostessPage.getByText(LOVE_TITLE)).toBeVisible();
  });

  await test.step("вещь «хочу» по ссылке фикстурного магазина: предзаполнение и цена", async () => {
    await hostessPage.goto("/room/add?zone=music");
    await hostessPage.getByRole("button", { name: /Хочу/ }).click();
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

    await hostessPage.getByRole("button", { name: /Поставить в комнату/ }).click();
    await hostessPage.waitForURL(/\/room\/zone\/music/);
    await hostessPage.getByRole("tab", { name: /Хочу · 1/ }).click();
    await expect(hostessPage.getByText(WANT_TITLE)).toBeVisible();
    await expect(hostessPage.getByText(/74\s?990/)).toBeVisible();
  });

  await test.step("адрес комнаты читается из UI", async () => {
    await hostessPage.goto("/room");
    const sharePath = (await hostessPage.getByText(/^\/r\//).textContent())?.trim() ?? "";
    roomSlug = sharePath.replace("/r/", "");
    expect(roomSlug).not.toBe("");
  });

  const wantItem = await prisma.item.findFirstOrThrow({
    where: { state: "WANT", room: { user: { email: HOSTESS_EMAIL } } },
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

    await guestPage.getByRole("button", { name: "Музыка — подойти ближе" }).click();
    await guestPage.getByRole("tab", { name: /Хочу · 1/ }).click();
    const wantTile = guestPage.locator("li", { hasText: WANT_TITLE });
    await expect(wantTile).toBeVisible();
    await expect(wantTile).toContainText(/74\s?990/); // цена «хочу» при видимости «все»
    await expect(wantTile.getByRole("button", { name: /Подарить$/ })).toBeVisible();

    // Цена «люблю» не существует ни у кого (инвариант №8): у вещи «люблю»
    // подпись «люблю» и никакого намёка на деньги в плитке.
    await guestPage.getByRole("tab", { name: /Люблю · 1/ }).click();
    const loveTile = guestPage.locator("li", { hasText: LOVE_TITLE });
    await expect(loveTile).toBeVisible();
    await expect(loveTile).toContainText("люблю");
    await expect(loveTile).not.toContainText("₽");
    await expect(loveTile).not.toContainText(/\d{3}/); // ни одной суммы в плитке
  });

  await test.step("негатив: /r/nonexistent → 404", async () => {
    const response = await guestPage.goto("/r/nonexistent");
    expect(response?.status()).toBe(404);
  });

  await test.step("гость логинится (иначе связь не родится) и визитом создаёт «смотрели»", async () => {
    await signInWithMagicLink(guestPage, GUEST_EMAIL);

    const visitPing = guestPage.waitForResponse(
      (response) =>
        response.url().includes("/visit") && response.request().method() === "POST",
    );
    await guestPage.goto(`/r/${roomSlug}`);
    expect((await visitPing).status()).toBe(204);

    // У хозяйки появилась связь «смотрели» — без имени брони, просто визит.
    await hostessPage.goto("/connections");
    const viewedRow = hostessPage.locator("li", { hasText: "Гость без имени" });
    await expect(viewedRow).toContainText("Смотрел(а)");
  });

  await test.step("гость тихо бронирует: «занято тобой» и «Мои брони · 1»", async () => {
    await guestPage.getByRole("button", { name: "Музыка — подойти ближе" }).click();
    await guestPage.getByRole("tab", { name: /Хочу · 1/ }).click();
    await guestPage.getByRole("button", { name: /Подарить$/ }).click();

    const dialog = guestPage.getByRole("dialog");
    await dialog.getByLabel("Твоё имя").fill(GUEST_NAME);
    await dialog.getByLabel(/Почта/).fill(GUEST_EMAIL);
    await dialog.getByRole("radio", { name: /^Тихо/ }).click();
    await dialog.getByRole("button", { name: /Подарить это/ }).click();

    await expect(guestPage.getByText("Вещь занята. Никому не скажем")).toBeVisible();
    await guestPage.getByRole("button", { name: "Хорошо" }).click();
    await expect(guestPage.getByText("занято тобой")).toBeVisible();
    await expect(guestPage.getByRole("link", { name: /Мои брони · 1/ })).toBeVisible();
  });

  await test.step("ИНВАРИАНТ: хозяйка видит только «1 вещь уже забрана», имени гостя нет нигде", async () => {
    await hostessPage.goto("/room");
    await expect(hostessPage.getByText("1 вещь уже забрана")).toBeVisible();

    // DOM текущей страницы…
    expect(await hostessPage.content()).not.toMatch(/Тайный|guest-e2e/);

    // …и ВСЕ network-ответы хозяйки за сессию (HTML, JSON, RSC): регекс по
    // телам. Дальше начинается «что подарили», где раскрытие легально, —
    // сбор останавливаем ровно здесь.
    await Promise.all(bodyReads);
    sweeping = false;
    expect(hostessBodies.length).toBeGreaterThan(10); // сбор действительно шёл
    const leaked = hostessBodies.filter(({ body }) => /Тайный|guest-e2e/.test(body));
    expect(
      leaked.map(({ url }) => url),
      "имя гостя/его почта протекли хозяйке до «что подарили»",
    ).toEqual([]);
  });

  await test.step("«праздник прошёл» вручную → строка с именем → «Дошло» → «уже в зале славы»", async () => {
    await hostessPage.goto("/room/occasion");
    await expect(
      hostessPage.getByRole("heading", { name: "Праздник ещё не закрыт" }),
    ).toBeVisible();
    await hostessPage.getByRole("button", { name: /Праздник прошёл/ }).click();

    // Ручное закрытие работает без даты: появляется итог с раскрытым именем.
    await expect(hostessPage.getByText(`Подарил(а) ${GUEST_NAME}`)).toBeVisible({
      timeout: 20_000,
    });
    await hostessPage.getByRole("button", { name: "Дошло" }).click();
    await expect(hostessPage.getByText(`${GUEST_NAME} · уже в зале славы`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(hostessPage.getByRole("link", { name: /Связь появилась/ })).toBeVisible();
  });

  await test.step("зал славы: вещь на подиуме с подписью дарителя", async () => {
    await hostessPage.goto("/room/hall");
    await expect(hostessPage.getByText(WANT_TITLE)).toBeVisible();
    const year = new Date().getUTCFullYear();
    await expect(hostessPage.getByText(`Подарен в ${year} · ${GUEST_NAME}`)).toBeVisible();
  });

  await test.step("связи: «Я слежу» (у гостя нет комнаты) с историей подарка", async () => {
    await hostessPage.goto("/connections");
    const row = hostessPage.locator("li", { hasText: "Гость без имени" });
    await expect(row).toContainText("Я слежу"); // FOLLOW: комната гостя не заведена
    await expect(row).toContainText("она в зале славы"); // происхождение из подарка
  });

  await test.step("письмо occasion-owner хозяйке лежит в E2E_MAIL_FILE", async () => {
    await expect
      .poll(
        () =>
          readMailRecords().some(
            (record) =>
              record.kind === "mail" &&
              record.to === HOSTESS_EMAIL &&
              (record.subject ?? "").includes("что подарили"),
          ),
        { timeout: 30_000, message: "письмо «открой „что подарили“» не дошло до файла" },
      )
      .toBe(true);
  });

  await guest.close();
  await hostess.close();
});

test("перф комнаты гостя (mobile-эмуляция): вес первого экрана и LCP", async ({ browser }) => {
  test.setTimeout(120_000);
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
      | PerformanceNavigationTiming
      | undefined;
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
