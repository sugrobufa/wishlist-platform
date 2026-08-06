// Отклик предмета светом (тикет 64).
//
// ЗАЧЕМ ТЕСТ. Обещание дизайну звучало так: «чтобы неоткрывающиеся зоны не были
// мёртвыми, мы добавим им движение в коде». Ломается такое обещание тихо —
// тремя способами сразу, и ни один не виден на глаз без сравнения:
//   1) свет достаётся не тем зонам (или отбирает поведение у зон С кадром);
//   2) длительности перестают приходить из motion.json и становятся своими;
//   3) затухание пропадает — и под открытым листом остаётся вечное свечение.
// Здесь проверяется каждый из трёх, а числа берутся из САМОГО пакета, а не
// переписываются в ожидания.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import motionJson from "@design/motion.json";
import { rooms } from "@/config/design";
import { wakeScore, zoneWakesWithLight } from "@/components/scene/zone-marker";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const stageTsx = read("../src/components/scene/SceneStage.tsx");

// Файл читается тремя кусками: правила покоя, десктопная ветка и ветка
// prefers-reduced-motion. Иначе «правило .wake» — это три разных правила, и
// проверка молча брала бы не то, которое имелось в виду.
const cut = (from: string, to?: string) => {
  const start = sceneCss.indexOf(from);
  expect(start, `в scene.module.css не нашлось «${from}»`).toBeGreaterThan(-1);
  const end = to ? sceneCss.indexOf(to) : sceneCss.length;
  return sceneCss.slice(start, end === -1 ? sceneCss.length : end);
};
const DESKTOP_AT = "@media (min-width: 1024px) {";
const REDUCED_AT = "@media (prefers-reduced-motion: reduce) {";
const KEYFRAMES_AT = "/* --- Кейфреймы";

const baseCss = sceneCss.slice(0, sceneCss.indexOf(DESKTOP_AT));
const desktopCss = cut(DESKTOP_AT, REDUCED_AT);
const reducedCss = cut(REDUCED_AT, KEYFRAMES_AT);

/** Тела всех правил куска, в списке селекторов которых есть `selector`. */
function bodies(css: string, selector: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter((m) =>
      (m[1] ?? "")
        .split(",")
        .map((part) => part.trim())
        .includes(selector),
    )
    .map((m) => m[2] ?? "");
}

/** Единственное правило селектора внутри куска; падает, если их не ровно одно. */
function rule(css: string, selector: string): string {
  const found = bodies(css, selector);
  expect(found.length, `ожидалось одно правило ${selector}, найдено ${found.length}`).toBe(1);
  return found[0] as string;
}

/** Фаза партитуры по имени — так же, как её ищет src/config/design.ts. */
function phase(what: string): { at?: unknown; duration?: unknown } {
  const list = (motionJson as { openZone: { what: string }[] }).openZone;
  const found = list.find((item) => item.what === what);
  expect(found, `в motion.json нет фазы «${what}»`).toBeDefined();
  return found as { at?: unknown; duration?: unknown };
}

// ---------- A. Кто отвечает светом ----------------------------------------

describe("светом отвечают ровно те зоны, у которых нет кадра «открыто»", () => {
  const all = rooms.flatMap((room) => room.zones.map((zone) => ({ room: room.id, zone })));

  it("правило одно и то же на все комнаты: либо кадр, либо свет, третьего нет", () => {
    for (const { room, zone } of all) {
      expect(
        zoneWakesWithLight(zone),
        `${room}/${zone.key}: свет и кадр разошлись с openFrame`,
      ).toBe(!zone.openFrame);
    }
  });

  it("кадр «открыто» есть у десяти зон продукта — им поведение не меняем", () => {
    const framed = all.filter(({ zone }) => !zoneWakesWithLight(zone));
    expect(framed.map(({ room, zone }) => `${room}/${zone.key}`).sort()).toEqual([
      "cream/anything",
      "cream/flowers",
      "cream/home",
      "cream/travel",
      "gamer/travel",
      "sport/anything",
      "sport/sneakers",
      "sport/travel",
      "study/events",
      "study/sport",
    ]);
  });

  it("свет достаётся всем остальным — тем самым мёртвым зонам из тикета", () => {
    const waking = all.filter(({ zone }) => zoneWakesWithLight(zone));
    // 122 показанные зоны продукта (CLAUDE.md, инвариант 9) минус 10 с кадром.
    expect(all.length).toBe(122);
    expect(waking.length).toBe(112);
  });

  it("комната без единого кадра оживает целиком, комната с кадрами — частями", () => {
    const cottage = rooms.find((room) => room.id === "cottage");
    const cream = rooms.find((room) => room.id === "cream");
    expect(cottage?.zones.every(zoneWakesWithLight)).toBe(true);
    expect(cream?.zones.filter(zoneWakesWithLight)).toHaveLength(9);
  });

  it("форма пятна берётся из контракта у КАЖДОЙ зоны, которая отвечает светом", () => {
    for (const { room, zone } of all.filter(({ zone }) => zoneWakesWithLight(zone))) {
      expect(Number.isFinite(zone.bloomAR), `${room}/${zone.key}: нет bloomAR`).toBe(true);
      expect(Number.isFinite(zone.bloomRot), `${room}/${zone.key}: нет bloomRot`).toBe(true);
    }
  });
});

// ---------- B. Числа — из motion.json, а не свои -------------------------

describe("партитура отклика собрана из фаз motion.json", () => {
  it("разгорание — фаза «Мебель раскрывается»: её место в партитуре и её длительность", () => {
    const open = phase("Мебель раскрывается");
    expect(wakeScore().atMs).toEqual(open.at);
    expect(wakeScore().riseMs).toBe(open.duration);
  });

  it("оседание — фаза «Оседание»: тот же такт, которым камера гасит перелёт", () => {
    expect(wakeScore().fallMs).toBe(phase("Оседание").duration);
  });

  it("телефон и десктоп расходятся ровно на столько, на сколько их развёл пакет", () => {
    const { atMs } = wakeScore();
    expect(atMs.phone).toBeLessThan(atMs.desktop);
    // Свет приходит, ПОКА камера ещё идёт: это и есть смысл выбранной фазы.
    const step = phase("Шаг: сдвиг к зоне").duration as { phone: number; desktop: number };
    expect(atMs.phone).toBeLessThan(150 + step.phone);
    expect(atMs.desktop).toBeLessThan(150 + step.desktop);
  });

  it("CSS не знает миллисекунд: обе фазы приезжают переменными из SceneStage", () => {
    const wake = rule(baseCss, ".wake");
    const glow = rule(baseCss, ".wakeGlow");
    expect(wake).toMatch(
      /animation:\s*wake-rise var\(--wake-ms\) var\(--ease-out\) var\(--wake-at\)/u,
    );
    expect(glow).toMatch(/animation:\s*wake-fall var\(--wake-out-ms\) var\(--ease-settle\)/u);
    expect(`${wake}${glow}`).not.toMatch(/\d+ms/u);
    for (const name of ["--wake-at", "--wake-at-d", "--wake-ms", "--wake-out-ms"]) {
      expect(stageTsx, `SceneStage не отдаёт ${name}`).toContain(`"${name}"`);
    }
    expect(stageTsx).toContain("wakeScore()");
  });
});

// ---------- C. Свет садится: постоянного свечения нет ---------------------

describe("свет разгорается и оседает", () => {
  it("оседание стартует ровно там, где кончилось разгорание", () => {
    expect(rule(baseCss, ".wakeGlow")).toMatch(/calc\(var\(--wake-at\) \+ var\(--wake-ms\)\)/u);
  });

  it("кадры затухания приходят в ноль — под открытым листом свечения не остаётся", () => {
    const fall = /@keyframes wake-fall \{([\s\S]*?)\n\}/u.exec(sceneCss)?.[1] ?? "";
    expect(fall).toMatch(/from \{\s*opacity: 1;/u);
    expect(fall).toMatch(/to \{\s*opacity: 0;/u);
  });

  it("обе фазы держат свои края (both) — до старта нуль, после оседания нуль", () => {
    expect(rule(baseCss, ".wake")).toMatch(/both;/u);
    expect(rule(baseCss, ".wakeGlow")).toMatch(/both;/u);
  });

  it("потолок — press-альфа метки зоны на вес света комнаты, а не своё число", () => {
    const rise = /@keyframes wake-rise \{([\s\S]*?)\n\}/u.exec(sceneCss)?.[1] ?? "";
    expect(rise).toMatch(
      /opacity: calc\(var\(--zone-bloom-press\) \* var\(--zone-bloom-weight\)\)/u,
    );
    expect(rise).not.toMatch(/opacity: 0?\.\d/u);
  });

  it("анимируется только прозрачность: box-shadow и filter на телефоне не тянутся", () => {
    const wakeCss = `${rule(baseCss, ".wake")}${rule(baseCss, ".wakeGlow")}`;
    expect(wakeCss).not.toMatch(/box-shadow|filter:/u);
    for (const name of ["wake-rise", "wake-fall"]) {
      const frames = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`, "u").exec(
        sceneCss,
      )?.[1] as string;
      expect(frames.replace(/opacity:[^;]+;/gu, "")).not.toMatch(/[a-z-]+:/u);
    }
  });

  it("форма пятна — из контракта зоны, вместе с поворотом и мягкой маской", () => {
    const glow = rule(baseCss, ".wakeGlow");
    expect(glow).toContain("var(--zone-bloom-bg)");
    expect(glow).toContain("rotate(var(--zone-bloom-rot, 0deg))");
    expect(glow).toContain("var(--zone-marker-mask)");
    expect(rule(baseCss, ".wake")).toContain("mix-blend-mode: var(--zone-bloom-blend)");
    expect(stageTsx).toContain("bloomShape(wakeZone.bloomAR)");
  });
});

// ---------- D. prefers-reduced-motion ------------------------------------

describe("prefers-reduced-motion: движение схлопывается, состояние остаётся", () => {
  it("контрактные 120 мс — из motion.json, не из головы", () => {
    const contract = (motionJson as { reducedMotion: { transitions: string } }).reducedMotion;
    expect(contract.transitions).toMatch(/120\s*ms/u);
    expect(reducedCss).toContain("var(--reduced-ms)");
  });

  it("разгорание сжимается до контрактных 120 мс и стартует без задержки", () => {
    const wake = rule(reducedCss, ".wake");
    expect(wake).toContain("animation-duration: var(--reduced-ms)");
    expect(wake).toContain("animation-delay: 0ms");
  });

  it("оседание выключено — свет ровно горит, пока зона открыта", () => {
    expect(rule(reducedCss, ".wakeGlow")).toMatch(/animation: none;/u);
  });

  it("свет не убит в ноль: «подошли» остаётся читаемым", () => {
    expect(`${rule(reducedCss, ".wake")}${rule(reducedCss, ".wakeGlow")}`).not.toMatch(
      /opacity: 0/u,
    );
  });
});

// ---------- E. Зоны с кадром не тронуты ----------------------------------

describe("у зон с кадром «открыто» поведение не изменилось", () => {
  it("слой света не монтируется вовсе — гейт один и тот же с openFrame", () => {
    expect(stageTsx).toContain("zoneWakesWithLight(activeZone) ? activeZone : null");
    // Единственное место, где слой попадает в разметку, — под этим гейтом.
    expect(stageTsx.match(/wakeLayer/gu)).toHaveLength(1);
    expect(stageTsx).toMatch(/\{wakeZone && wakeBox && \([\s\S]{0,200}s\.wakeLayer/u);
  });

  it("правила кроссфейда кадра про свет ничего не знают", () => {
    for (const selector of [".openFrame", ".openFrameOn"]) {
      for (const body of bodies(sceneCss, selector)) {
        expect(body, `${selector} задет отликом света`).not.toMatch(/wake/u);
      }
    }
    expect(bodies(sceneCss, ".wake").join(""), "слой света трогает кадр").not.toMatch(/openFrame/u);
  });

  it("геометрия слоя света повторяет слой кадра на обоих видах", () => {
    expect(rule(baseCss, ".wakeLayer")).toContain("left: var(--frame-l)");
    // Десктоп: тот же список селекторов, что у кадра и хотспотов, — значит и
    // тело одно на троих, разъехаться на своё число слою света негде.
    expect(rule(desktopCss, ".wakeLayer")).toContain("left: var(--frame-l-d)");
    expect(rule(desktopCss, ".wakeLayer")).toBe(rule(desktopCss, ".frame"));
    expect(bodies(desktopCss, ".hotspots")).toContain(rule(desktopCss, ".wakeLayer"));
  });

  it("десктопная задержка переопределяется на слоях, а не на .stage (инлайн выиграл бы)", () => {
    expect(rule(desktopCss, ".wake")).toContain("--wake-at: var(--wake-at-d)");
    expect(rule(desktopCss, ".wake")).toBe(rule(desktopCss, ".wakeGlow"));
    const stage = bodies(sceneCss, ".stage").join("");
    expect(stage, ".stage получает --wake-at из инлайна — правило CSS ему проиграет").not.toMatch(
      /--wake-at/u,
    );
  });
});
