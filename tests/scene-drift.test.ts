// Дрейф комнаты в покое (тикет 72, турн 28b).
//
// ЗАЧЕМ ТЕСТ. У дрейфа четыре условия, и все четыре ломаются молча:
//   1) он идёт У ОБОИХ — хозяйке тоже (тикет 103, решение владельца
//      08.08.2026: «чтобы пользователь понимал, что комната шире, чем он
//      видит»). Прежнее «только гостю» отменено им же: знание про ширину
//      кадра не приходит от знакомства с содержимым комнаты;
//   2) касание, драг и открытие зоны ставят его на ПАУЗУ, иначе в зону не
//      прицелиться — зона уезжает из-под пальца; пауза кончается сама
//      (тикет 117), прежде она была вечной;
//   3) он идёт через ТУ ЖЕ переменную пана, что панорама пальцем, иначе
//      указатель зон разъедется с окном;
//   4) при `prefers-reduced-motion` его нет вовсе — это ровно тот случай,
//      ради которого настройка существует.
// Ни одно из четырёх не видно на глаз без сравнения, поэтому читаем источник —
// тем же приёмом, что `zone-wake.test.ts` читает CSS. Арифметика плеча и выбор
// направления вынесены в чистые функции и проверяются по-настоящему.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { phonePanRange } from "../src/components/scene/immersive-layout";
import { driftLegMs, driftTargetFrom } from "../src/components/scene/use-scene-pan";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const pan = read("../src/components/scene/use-scene-pan.ts");
const stage = read("../src/components/scene/SceneStage.tsx");
const guestPage = read("../src/app/r/[slug]/page.tsx");
const ownerPage = read("../src/app/room/page.tsx");

/** Скорость проезда с доски (турн 28b): единиц кадра 630×351 в секунду. */
const UNITS_PER_S = 23;

describe("арифметика проезда", () => {
  it("окно едет ровно на ширину кадра за вычетом своей — 200 единиц", () => {
    const { min, max } = phonePanRange();
    // Кадр 630, окно 430, сдвиг −12: путь от −12 до 188.
    expect(min).toBe(-12);
    expect(max).toBe(188);
    expect(max - min).toBe(200);
  });

  it("плечо считается путём ÷ скорость, а не задаётся числом", () => {
    const { min, max } = phonePanRange();
    const legMs = ((max - min) / UNITS_PER_S) * 1000;
    // ≈ 8.7 с на проход — тот же порядок, что у дыхания кадра (15 с, phone).
    expect(legMs).toBeGreaterThan(8000);
    expect(legMs).toBeLessThan(9500);
    // Скорость записана в коде именно так, а не «на глаз» подобранной мс.
    expect(pan).toMatch(/const DRIFT_UNITS_PER_S = 23;/u);
    expect(pan).toMatch(/Math\.abs\(to - from\) \/ DRIFT_UNITS_PER_S/u);
  });
});

describe("условия дрейфа", () => {
  it("выключен при prefers-reduced-motion", () => {
    expect(pan).toMatch(/if \(!enabled \|\| !drift \|\| reducedMotion\) return;/u);
  });

  it("касание ставит его на ПАУЗУ, а не гасит навсегда (тикет 117)", () => {
    // freezeIntro зовётся из pointerdown — там же и ставится пауза. Флага
    // «остановлен навсегда» в файле больше нет вовсе: одно касание не должно
    // оставлять комнату стоять до перезагрузки страницы.
    expect(pan).not.toContain("driftStoppedRef");
    expect(pan).toMatch(/const freezeIntro = \(\) => \{[\s\S]{0,400}pauseDriftRef\.current\(\);/u);
    // Плечо проверяет паузу перед каждым ходом: тронули посреди проезда —
    // следующее плечо не начнётся.
    expect(pan).toMatch(
      /const leg = \(from: number, to: number\) => \{\s*if \(driftPausedRef\.current \|\| zoomedRef\.current \|\| dragRef\.current\) return;/u,
    );
  });

  it("открытие зоны — тоже пауза: отсчёт пойдёт с закрытия", () => {
    expect(pan).toMatch(/if \(zoomed\) \{[\s\S]{0,400}pauseDriftRef\.current\(\);/u);
    // Пока зона открыта, эффект дрейфа не заводит вообще ничего.
    expect(pan).toMatch(/\/\/ Зона открыта[\s\S]{0,220}if \(zoomed\) return;/u);
  });

  it("едет через ту же переменную окна, второго сдвига нет", () => {
    // Единственная запись позиции — applyRef, и она ставит --win-pan.
    expect(pan).toMatch(/setProperty\("--win-pan"/u);
    const writes = [...pan.matchAll(/setProperty\("--win-pan"/gu)];
    expect(writes, "позицию окна пишет ровно одно место").toHaveLength(1);
    // Сам дрейф не трогает DOM мимо него.
    expect(pan).toMatch(/applyRef\.current\(to, ms, "ease-in-out"\);/u);
  });

  it("автопроезд тикета 55 не задвоен: при дрейфе он выключен", () => {
    expect(pan).toMatch(/if \(!enabled \|\| reducedMotion \|\| drift\) return;/u);
  });
});

describe("кому достаётся", () => {
  /** Тег `<SceneStage … />` целиком: он растёт от тикета к тикету, и мерить
   *  его длину окнами в регулярке — способ падать на чужой правке. */
  const sceneTag = (source: string) => {
    const match = /<SceneStage\b[\s\S]*?\/>/u.exec(source);
    expect(match, "в файле нет тега <SceneStage …/>").not.toBeNull();
    return (match as RegExpExecArray)[0];
  };

  it("гость — с дрейфом", () => {
    expect(sceneTag(guestPage)).toMatch(/^\s*drift$/mu);
  });

  it("хозяйка — тоже с дрейфом (тикет 103)", () => {
    // Замок перевёрнут вместе с причиной: владелец решил, что проезд нужен
    // обоим. Автопроезд тикета 55 при этом не задваивается — он выключается
    // самим флагом (проверка выше).
    expect(sceneTag(ownerPage)).toMatch(/^\s*drift$/mu);
  });

  it("по умолчанию дрейфа нет — включать надо осознанно", () => {
    expect(stage).toMatch(/drift = false,/u);
  });
});

// --- Тикет 117: пауза вместо вечной остановки -----------------------------
//
// Приёмка владельца 09.08.2026: «после того как я тронул пространство, оно
// спустя время перестаёт двигаться туда и обратно; спустя некоторое время
// комната должна гулять как и при первом входе». Это была не поломка, а наше
// решение — и неверное: довод «тронул, значит управляешь сам» действует ровно
// пока рука на экране.
describe("возврат дрейфа после паузы (тикет 117)", () => {
  it("пауза измеряется покоем и снимается таймером, а не живёт вечно", () => {
    // Число наше, дизайн его не давал — рядом с DRIFT_DELAY_MS и с этим же
    // примечанием, как просит тикет.
    expect(pan).toMatch(/const DRIFT_RESUME_MS = 6000;/u);
    expect(pan).toMatch(/ЧИСЛО НАШЕ, ДИЗАЙН ЕГО НЕ ДАВАЛ/u);
    const resume = /const pauseDriftRef = useRef\(\(\) => \{([\s\S]*?)\n  \}\);/u.exec(pan)?.[1];
    expect(resume, "не нашлась функция паузы").toBeDefined();
    expect(resume).toMatch(/driftPausedRef\.current = true;/u);
    expect(resume).toMatch(/window\.setTimeout\([\s\S]*DRIFT_RESUME_MS\)/u);
    expect(resume).toMatch(/driftPausedRef\.current = false;/u);
    expect(resume).toMatch(/driftRestartRef\.current\?\.\(\);/u);
  });

  it("отсчёт живёт в тех же таймерах — второго механизма не завели", () => {
    const resume = /const pauseDriftRef = useRef\(\(\) => \{([\s\S]*?)\n  \}\);/u.exec(pan)?.[1];
    expect(resume).toMatch(/clearIntroRef\.current\(\);/u);
    expect(resume).toMatch(/introTimersRef\.current\.push\(resume\);/u);
    // Повторный вызов — и есть «отсчёт сброшен»: старый таймер гаснет вместе
    // с остальными, новый заводится следом. Мест ровно четыре: три действия
    // человека (касание, конец драга, наезд на зону) и перезапуск эффекта
    // дрейфа, чья уборка гасит незаконченный отсчёт.
    expect(pan.match(/pauseDriftRef\.current\(\);/gu)?.length, "мест, где ставится пауза").toBe(4);
  });

  it("любое новое действие переставляет отсчёт заново", () => {
    // Касание (freezeIntro ← pointerdown), конец драга и наезд на зону.
    expect(pan).toMatch(/const freezeIntro = \(\) => \{[\s\S]{0,400}pauseDriftRef\.current\(\);/u);
    expect(pan).toMatch(/const endDrag = [\s\S]{0,500}pauseDriftRef\.current\(\);/u);
    expect(pan).toMatch(/if \(zoomed\) \{[\s\S]{0,400}pauseDriftRef\.current\(\);/u);
  });

  it("при открытой зоне и под пальцем дрейф не стартует, даже когда отсчёт вышел", () => {
    const resume = /const pauseDriftRef = useRef\(\(\) => \{([\s\S]*?)\n  \}\);/u.exec(pan)?.[1];
    expect(resume).toMatch(/if \(zoomedRef\.current \|\| dragRef\.current\) return;/u);
    // И сам пуск проверяет то же самое ещё раз — на случай гонки таймеров.
    expect(pan).toMatch(
      /const startFromHere = \(\) => \{\s*if \(driftPausedRef\.current \|\| zoomedRef\.current \|\| dragRef\.current\) return;/u,
    );
  });

  it("при prefers-reduced-motion возврата нет вовсе — эффект даже не заводится", () => {
    // Единственный вход в дрейф — этот эффект; его первая строка и есть замок.
    expect(pan).toMatch(
      /if \(!enabled \|\| !drift \|\| reducedMotion\) return;[\s\S]{0,20}\/\/ Зона открыта/u,
    );
    // И у хозяйки/гостя правило одно: возвращается то, что было включено
    // пропом `drift`. Отдельной ветки «кому возвращать» нет.
    expect(pan).not.toMatch(/owner|хозяйк[аи] — не/u);
  });

  it("пуск идёт ОТ ТЕКУЩЕГО положения окна, а не рывком в край", () => {
    expect(pan).toMatch(/const here = clampPan\(panRef\.current\);\s*\n\s*leg\(here, driftTargetFrom\(here/u);
    const { min, max } = phonePanRange();
    // Из покоя — к дальнему краю, как и было.
    expect(driftTargetFrom(0)).toBe(max);
    // Окно уехало вправо — дальний край теперь левый.
    expect(driftTargetFrom(max)).toBe(min);
    expect(driftTargetFrom(100)).toBe(min);
    // Ровно посередине пути выбор в пользу max (плечи равны).
    expect(driftTargetFrom((min + max) / 2)).toBe(max);
    // За краем (резина) — сначала клампится, поэтому направление осмысленно.
    expect(driftTargetFrom(max + 40)).toBe(min);
  });

  it("плечо после паузы считается путём ÷ скорость — как и первое", () => {
    const { min, max } = phonePanRange();
    expect(driftLegMs(min, max)).toBe(Math.round((200 / UNITS_PER_S) * 1000));
    expect(driftLegMs(100, -12)).toBe(Math.round((112 / UNITS_PER_S) * 1000));
    // Ход после паузы НИКОГДА не вырождается в ноль: худший случай — середина
    // пути, и это всё равно половина плеча (≈4.3 с).
    for (let here = min; here <= max; here += 1) {
      const ms = driftLegMs(here, driftTargetFrom(here));
      expect(ms, `из ${here}`).toBeGreaterThanOrEqual(Math.round((100 / UNITS_PER_S) * 1000));
    }
  });
});
