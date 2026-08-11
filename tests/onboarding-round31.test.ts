// Онбординг по раунду 31 (тикет 134, письмо 33 · турн 40): слова первого шага,
// локап Grace на всех шагах, ТРИ шага вместо четырёх, перечень полок снят,
// карточки заготовок одной высоты.
//
// ПОЧЕМУ ПРОВЕРКА ИСХОДНИКОМ. Тот же приём, что у знаков угла сцены
// (tests/scene-corner.test.ts): числа дизайна и снятые контролы видно прямо в
// разметке, а поднимать next-intl и рендерить три шага ради строки «Шаг 3 из 3»
// дороже, чем эта строка стоит. Живой проход по шагам держит e2e — и что он
// больше не жмёт «Пропустить», проверяется здесь же.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ru from "../messages/ru.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const flow = read("../src/app/onboarding/onboarding-flow.tsx");
const onboardingPage = read("../src/app/onboarding/page.tsx");
const logoRoute = read("../src/app/logo/[file]/route.ts");
const fullCycle = read("../e2e/full-cycle.spec.ts");

/** Локап лежит В РЕПОЗИТОРИИ, в пакете дизайна: тот же адрес, что у знаков. */
const LOCKUP_FILE = path.join("design", "package", "handoff", "logo", "grace-lockup-outlined.svg");

const onboarding = (ru as unknown as { Onboarding: Record<string, string> }).Onboarding;

describe("шагов три, а не четыре", () => {
  it("TOTAL_STEPS и тип шага говорят одно число", () => {
    expect(flow).toMatch(/const TOTAL_STEPS = 3;/u);
    expect(flow).toMatch(/type Step = 1 \| 2 \| 3;/u);
  });

  it("счётчик шага идёт 1 → 2 → 3 и четвёртого не называет", () => {
    const numbers = [...flow.matchAll(/current: (\d+), total: TOTAL_STEPS/gu)].map((m) =>
      Number(m[1]),
    );
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("вопроса «что хочется» в онбординге не осталось ни строкой, ни чипом", () => {
    // Шаг снят целиком: ни одной строки словаря `wants*`, ни состояния ответа,
    // ни скрытого поля `wants` в форме создания комнаты. (Слово в комментариях
    // живо — оно рассказывает, куда вопрос уехал.)
    expect(flow).not.toMatch(/t\("wants\w*"\)/u);
    expect(flow).not.toMatch(/name="wants"/u);
    expect(flow).not.toMatch(/setWants|WANTS_MAX/u);
    expect(read("../src/app/onboarding/actions.ts")).not.toMatch(/formData\.get\("wants"\)/u);
  });

  it("ни одной строки вопроса в словаре не осталось", () => {
    // ТИКЕТ 134 УБРАЛ МЕСТО ВОПРОСА, ТИКЕТЫ 189 И 191 — САМ ВОПРОС. Раунд 31
    // снял подпись шага и кнопку пропуска, а слова оставил: вопрос уехал чипами
    // в первое открытие «начни с готового». Владелец 11.08.2026 снял и набор, и
    // вопрос — «ничего не происходит и непонятно, на что это влияет», — и в
    // словаре продукта не осталось ни одного `wants*`. У дизайна они живы, и в
    // сверке с пакетом записаны как «пакет знает, у нас нет»
    // (tests/messages-tone.test.ts → PACKAGE_ONLY).
    for (const key of ["wantsStep", "wantsSkip", "wantsTitle", "wantsSubtitle", "wantsMax"]) {
      expect(onboarding[key], `Onboarding.${key}`).toBeUndefined();
    }
  });
});

describe("локап Grace на шагах — числа дизайна", () => {
  it("высота 22, ширина из вьюбокса, opacity .92, top = safe-area + 30, до оверлайна 28", () => {
    expect(flow).toMatch(/const LOCKUP_HEIGHT = 22;/u);
    expect(flow).toMatch(/const LOCKUP_WIDTH = Math\.round\(\(LOCKUP_HEIGHT \* 176\) \/ 48\);/u);
    expect(flow).toContain("opacity: 0.92");
    expect(flow).toContain('paddingTop: "calc(env(safe-area-inset-top, 0px) + 30px)"');
    expect(flow).toContain("marginBottom: 28");
  });

  it("стоит на всех трёх шагах одинаково — одним компонентом", () => {
    expect([...flow.matchAll(/<StepLockup/gu)]).toHaveLength(3);
    // Не кнопка: нажатия у самого знака нет, а «Назад» — отдельная кнопка рядом.
    expect(flow).not.toMatch(/<img[^>]*onClick/u);
  });

  it("файл берём из пакета и он контурный (проверка из logo/README)", () => {
    const svg = readFileSync(LOCKUP_FILE, "utf8");
    expect(svg.length).toBeGreaterThan(3000); // меньше 3 КБ — контуров внутри нет
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
    // Раздаём файл как есть, тем же способом, что кадры комнат.
    expect(logoRoute).toContain("design");
    expect(logoRoute).toMatch(/SAFE_LOGO_NAME = \/\^\[a-z0-9\]\[a-z0-9-\]\*\\\.svg\$\//u);
    expect(flow).toContain('const LOCKUP_URL = "/logo/grace-lockup-outlined.svg"');
  });

  it("раздача отдаёт ИМЕННО этот файл и никакой другой", async () => {
    const { GET } = await import("../src/app/logo/[file]/route");
    const call = (file: string) =>
      GET(new Request(`http://localhost/logo/${file}`), { params: Promise.resolve({ file }) });

    const ok = await call("grace-lockup-outlined.svg");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await ok.text()).toBe(readFileSync(LOCKUP_FILE, "utf8"));

    // Обход каталога и чужие расширения невозможны по построению.
    for (const bad of ["../../../.env", "grace-lockup-8x.png", "a/b.svg", "GRACE.svg"]) {
      expect((await call(bad)).status, bad).toBe(404);
    }
  });
});

describe("перечень полок с шага выбора комнаты снят", () => {
  it("ни строки «Зоны этой комнаты», ни подписей зон в онбординге", () => {
    expect(flow).not.toContain("zonesTitle");
    expect(flow).not.toContain("zoneLabels");
    expect(onboardingPage).not.toMatch(/zoneLabels|zoneKeys/u);
    expect(onboarding.zonesTitle).toBeUndefined();
  });
});

describe("карточки заготовок: длина описания не двигает счётчик", () => {
  it("карточка — колонка, описание тянется, счётчик прижат к низу", () => {
    // Приёмка 09.08: у «Мужской» описание в одну строку против двух у соседей,
    // и «4 КОМНАТЫ» стояли на 12 px выше. Ряд держится раскладкой, а не длиной
    // текста: `flex-col` + `grow` у описания.
    expect(flow).toContain("pressable flex flex-1 flex-col border");
    expect(flow).toContain("mt-1 block grow text-sm");
    const card = flow.slice(flow.indexOf("pressable flex flex-1 flex-col border"));
    expect(card.indexOf("grow")).toBeLessThan(card.indexOf('t("roomCount"'));
  });
});

describe("e2e идёт по трём шагам", () => {
  it("«Пропустить» на третьем шаге больше не жмётся", () => {
    // Ни нажатия, ни ожидания заголовка снятого шага — в СЕЛЕКТОРАХ; в
    // комментарии прогона объяснение того, что изменилось, остаётся.
    expect(fullCycle).not.toMatch(/name: \/Пропустить\//u);
    expect(fullCycle).not.toContain('name: "Что чаще всего хочется?"');
  });

  it("прогон сверяет само число шагов", () => {
    expect(fullCycle).toContain("Шаг 3 из 3");
  });
});
