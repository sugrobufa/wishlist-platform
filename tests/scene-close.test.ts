// ВЫХОД ИЗ ЗОНЫ — числа closeZone (долг В10, ADR-0003 §4).
//
// ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ. Контракт описывает выход тремя фазами: «Сетка гаснет»
// (0 · 200), «Камера отходит» (120 · 760/820, кривая settle) и «Вуаль
// поднимается» (120 · 600, кривая out). Код распаковывал одну первую, а камера
// уезжала на числах ВХОДА — 720/810 кривой `out` и без задержки. Разъезд был
// тихим: движение есть, направление верное, и на глаз «просто чуть быстрее».
//
// Поэтому тест берёт числа ИЗ САМОГО ПАКЕТА, а не переписывает их в ожидания:
// если дизайн поменяет длительность или кривую, упадёт связка «код ↔ контракт»,
// а не сверка с зафиксированной цифрой. Отдельные проверки на буквальные
// значения тоже есть — они сторожат обратную сторону: что мы не начали читать
// не ту фазу.
//
// CSS читается тем же приёмом, что в `zone-wake.test.ts`: миллисекунд в нём
// нет, всё приезжает переменными из SceneStage.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import motionJson from "@design/motion.json";
import { sceneMotion } from "@/config/design";
import { closeScore, walkScore } from "@/components/scene/camera";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const stageTsx = read("../src/components/scene/SceneStage.tsx");
const panTs = read("../src/components/scene/use-scene-pan.ts");

const DESKTOP_AT = "@media (min-width: 1024px) {";
const REDUCED_AT = "@media (prefers-reduced-motion: reduce) {";
const KEYFRAMES_AT = "/* --- Кейфреймы";

const baseCss = sceneCss.slice(0, sceneCss.indexOf(DESKTOP_AT));
const desktopCss = sceneCss.slice(sceneCss.indexOf(DESKTOP_AT), sceneCss.indexOf(REDUCED_AT));
const reducedCss = sceneCss.slice(sceneCss.indexOf(REDUCED_AT), sceneCss.indexOf(KEYFRAMES_AT));

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

/** Единственное тело со свойством `transition` среди правил селектора. */
function transitionOf(css: string, selector: string): string {
  const found = bodies(css, selector).filter((body) => /transition/u.test(body));
  expect(found.length, `ожидалось одно правило ${selector} с transition`).toBe(1);
  return found[0] as string;
}

type Ms = number | { phone: number; desktop: number };
type ClosePhase = { at: Ms; what: string; duration?: Ms; easing?: string };

/** Фаза выхода по имени — так же, как её ищет src/config/design.ts. */
function phase(what: string): ClosePhase {
  const list = (motionJson as unknown as { closeZone: ClosePhase[] }).closeZone;
  const found = list.find((item) => item.what === what);
  expect(found, `в motion.json нет фазы «${what}»`).toBeDefined();
  return found as ClosePhase;
}

const easings = (motionJson as unknown as { easing: Record<string, string> }).easing;

describe("closeZone распакован целиком — три фазы, а не одна", () => {
  it("в контракте ровно три фазы, и у кода есть все три", () => {
    const list = (motionJson as unknown as { closeZone: ClosePhase[] }).closeZone;
    expect(list.map((item) => item.what)).toEqual([
      "Сетка гаснет",
      "Камера отходит",
      "Вуаль поднимается",
    ]);
    expect(Object.keys(sceneMotion.close).sort()).toEqual(["camera", "grid", "veil"]);
  });

  it("«Сетка гаснет» — с нуля, 200 мс", () => {
    const contract = phase("Сетка гаснет");
    const close = closeScore("phone");
    expect(close.grid.atMs).toBe(contract.at);
    expect(close.grid.durationMs).toBe(contract.duration);
    expect(close.grid).toEqual({ atMs: 0, durationMs: 200 });
  });

  it("«Камера отходит» — 760/820, кривая settle, старт +120", () => {
    const contract = phase("Камера отходит");
    const duration = contract.duration as { phone: number; desktop: number };
    for (const view of ["phone", "desktop"] as const) {
      const close = closeScore(view);
      expect(close.camera.atMs, view).toBe(contract.at);
      expect(close.camera.durationMs, view).toBe(duration[view]);
      // Кривая берётся ПО ИМЕНИ из словаря контракта, а не подставляется рядом.
      expect(close.camera.easing, view).toBe(easings[contract.easing as string]);
    }
    expect(closeScore("phone").camera).toEqual({
      atMs: 120,
      durationMs: 760,
      easing: easings.settle,
    });
    expect(closeScore("desktop").camera.durationMs).toBe(820);
  });

  it("«Вуаль поднимается» — 600 мс кривой out, тот же старт +120", () => {
    const contract = phase("Вуаль поднимается");
    const close = closeScore("phone");
    expect(close.veil.atMs).toBe(contract.at);
    expect(close.veil.durationMs).toBe(contract.duration);
    expect(close.veil.easing).toBe(easings[contract.easing as string]);
    expect(close.veil).toEqual({ atMs: 120, durationMs: 600, easing: easings.out });
    // Камера и вуаль трогаются ОДНОВРЕМЕННО — так написано в партитуре.
    expect(close.veil.atMs).toBe(close.camera.atMs);
  });

  it("весь выход укладывается в 880 / 940 мс", () => {
    expect(closeScore("phone").totalMs).toBe(880);
    expect(closeScore("desktop").totalMs).toBe(940);
    // Камера — самая длинная фаза: она и определяет конец выхода.
    expect(closeScore("phone").totalMs).toBe(120 + 760);
  });

  it("ВЫХОД БОЛЬШЕ НЕ ЕДЕТ НА ЧИСЛАХ ВХОДА (ровно тот долг, что чинится)", () => {
    // Прежде камера уезжала длительностью фазы «Шаг: сдвиг к зоне» (720/810)
    // кривой `out` и без задержки — три расхождения с контрактом сразу.
    for (const view of ["phone", "desktop"] as const) {
      const walk = walkScore(view);
      const close = closeScore(view);
      expect(close.camera.durationMs, view).not.toBe(walk.pan.durationMs);
      expect(close.camera.easing, view).not.toBe(walk.pan.easing);
      expect(close.camera.atMs, view).toBeGreaterThan(0);
      // Наружу спокойнее, чем внутрь, — довод контракта числом.
      expect(close.camera.durationMs, view).toBeGreaterThan(walk.zoom.durationMs);
    }
    // Общего числа «длительность камеры» больше нет вовсе: у входа и выхода
    // свои. Если оно вернётся, вернётся и соблазн подставить его в выход.
    expect(sceneMotion.camera).not.toHaveProperty("durationMs");
    expect(stageTsx).not.toContain("--cam-ms");
    expect(sceneCss).not.toContain("--cam-ms");
  });
});

describe("числа выхода доезжают до CSS переменными, а не литералами", () => {
  it("SceneStage отдаёт все переменные выхода", () => {
    for (const [name, value] of [
      ["--close-at", `${closeScore("phone").camera.atMs}ms`],
      ["--close-ms", `${closeScore("phone").camera.durationMs}ms`],
      ["--close-ms-d", `${closeScore("desktop").camera.durationMs}ms`],
      ["--close-ease", closeScore("phone").camera.easing],
      ["--veil-out-at", `${closeScore("phone").veil.atMs}ms`],
      ["--veil-out-ms", `${closeScore("phone").veil.durationMs}ms`],
      ["--veil-out-ease", closeScore("phone").veil.easing],
    ] as const) {
      expect(stageTsx, `SceneStage не отдаёт ${name}`).toContain(`"${name}"`);
      expect(value.length, `${name} пустая`).toBeGreaterThan(0);
    }
    // Числа приходят из партитуры, а не набиты в компоненте.
    expect(stageTsx).toContain('closeScore("phone")');
    expect(stageTsx).toContain('closeScore("desktop")');
    expect(stageTsx).not.toMatch(/--close-(at|ms|ms-d)": "\d/u);
  });

  it("правило ПОКОЯ пяти слоёв камеры и есть выход", () => {
    const rest = transitionOf(baseCss, ".camera");
    expect(rest).toMatch(
      /transition:\s*transform var\(--close-ms\) var\(--close-ease\) var\(--close-at\)/u,
    );
    // Одно правило на все пять слоёв: перелёта на выходе нет, значит и разных
    // темпов у слоёв нет.
    for (const layer of [".over", ".settle", ".pan", ".zoom"]) {
      expect(transitionOf(baseCss, layer), layer).toBe(rest);
    }
    expect(rest, "в CSS не должно быть миллисекунд").not.toMatch(/\d+ms/u);
  });

  it("десктоп переопределяет ровно длительность выхода", () => {
    expect(bodies(desktopCss, ".camera").join("")).toContain(
      "transition-duration: var(--close-ms-d)",
    );
    for (const layer of [".over", ".settle", ".pan", ".zoom"]) {
      expect(bodies(desktopCss, layer).join(""), layer).toContain("var(--close-ms-d)");
    }
  });

  it("вход не задет: у всех пяти слоёв `.zoomed` свои длительность, кривая и старт", () => {
    // Если бы правило входа не задавало transition ЦЕЛИКОМ, числа выхода
    // просочились бы в наезд через сокращённую запись.
    for (const [selector, expected] of [
      [".zoomed .camera", /transition: transform var\(--lead-ms\) var\(--ease-out\)/u],
      [".zoomed .over", /var\(--step-ms\) var\(--ease-walk\) var\(--step-at\)/u],
      [".zoomed .settle", /var\(--settle-ms\) var\(--ease-settle\) var\(--settle-at\)/u],
      [".zoomed .pan", /var\(--pan-ms\) var\(--ease-walk\) var\(--pan-at\)/u],
      [".zoomed .zoom", /var\(--step-ms\) var\(--ease-walk\) var\(--step-at\)/u],
    ] as const) {
      const body = bodies(baseCss, selector).join("");
      expect(body, selector).toMatch(expected);
      expect(body, `${selector} взял числа выхода`).not.toMatch(/--close-/u);
    }
  });

  it("вуаль: покой — подъём по closeZone, `.veilOn` — своё затемнение по openZone", () => {
    expect(transitionOf(baseCss, ".veil")).toMatch(
      /transition:\s*opacity var\(--veil-out-ms\) var\(--veil-out-ease\) var\(--veil-out-at\)/u,
    );
    expect(transitionOf(baseCss, ".veilOn")).toMatch(
      /transition:\s*opacity var\(--veil-ms\) var\(--ease-out\) var\(--veil-at\)/u,
    );
    // Вход вуали не изменился: 560 мс со стартом 90 (openZone «Периферия
    // темнеет») — их сторожит scene-camera.test.ts, здесь только связь.
    expect(sceneMotion.veil).toEqual({ delayMs: 90, durationMs: 560 });
  });

  it("окно (сани пана) возвращается той же фазой: длительность, кривая и старт", () => {
    expect(panTs).toContain('closeScore("phone")');
    expect(panTs).toContain("CLOSE.camera.durationMs");
    expect(panTs).toContain("CLOSE.camera.easing");
    expect(panTs).toContain("CLOSE.camera.atMs");
    // Числа входа из возврата ушли.
    expect(panTs).not.toContain("sceneMotion.camera.durationMs");
    expect(sceneCss).toContain("var(--win-pan-at, 0ms)");
  });
});

describe("сцена отпускает камеру в начале выхода, а не в конце первой фазы", () => {
  it("наезд снимается на фазе «closing» — камера трогается со своей задержкой", () => {
    // Ключевая правка: `zoomedIn` привязан к фазе «open». Пока он значил
    // «не idle», класс `zoomed` держался все 200 мс «сетка гаснет», и камера
    // трогалась на 200-й мс вместо 120-й — вопреки партитуре.
    expect(stageTsx).toMatch(/const zoomedIn = phase === "open" && activeZone !== null;/u);
    expect(stageTsx).toMatch(/const zoneOpen = phase !== "idle" && activeZone !== null;/u);
    // Камера и вуаль слушают камерный флаг…
    expect(stageTsx).toMatch(/const camera = zoomedIn \? computeZoneCamera/u);
    expect(stageTsx).toMatch(/zoomedIn \? `\$\{s\.veil\} \$\{s\.veilOn\}` : s\.veil/u);
    expect(stageTsx).toMatch(/zoomedIn \? `\$\{s\.viewport\} \$\{s\.zoomed\}` : s\.viewport/u);
    // …а лист вещей и подпись — тот, что живёт до конца первой фазы.
    expect(stageTsx).toMatch(/zone=\{zoneOpen \? activeZone : null\}/u);
    expect(stageTsx).toMatch(/\{zoneOpen && \(/u);
  });

  it("таймер JS отмеряет ровно первую фазу — остальные ведёт CSS", () => {
    expect(stageTsx).toContain("CLOSE_PHONE.grid.durationMs");
    // Ни камеры, ни вуали в таймерах: их задержка живёт в transition-delay.
    expect(stageTsx).not.toMatch(/setTimeout[\s\S]{0,200}CLOSE_PHONE\.camera/u);
  });
});

describe("prefers-reduced-motion: выход схлопывается по контракту", () => {
  it("контрактные 120 мс, и они же в переменной", () => {
    const contract = (motionJson as unknown as { reducedMotion: { transitions: string } })
      .reducedMotion;
    expect(contract.transitions).toMatch(/120\s*ms/u);
    expect(sceneMotion.reducedTransitionMs).toBe(120);
  });

  it("пять слоёв камеры и вуаль теряют И длительность выхода, И его задержку", () => {
    const collapsed = bodies(reducedCss, ".camera").join("");
    expect(collapsed).toContain("transition-duration: var(--reduced-ms)");
    expect(collapsed).toContain("transition-delay: 0ms");
    for (const selector of [".over", ".settle", ".pan", ".zoom", ".veil"]) {
      const body = bodies(reducedCss, selector).join("");
      expect(body, selector).toContain("transition-duration: var(--reduced-ms)");
      expect(body, `${selector} оставил задержку выхода`).toContain("transition-delay: 0ms");
    }
  });

  it("правила наезда (специфичнее покоя) схлопнуты отдельно — иначе выиграли бы", () => {
    for (const selector of [".zoomed .camera", ".zoomed .over", ".zoomed .settle", ".zoomed .pan"]) {
      const body = bodies(reducedCss, selector).join("");
      expect(body, selector).toContain("transition-duration: var(--reduced-ms)");
      expect(body, selector).toContain("transition-delay: 0ms");
    }
    expect(bodies(reducedCss, ".veilOn").join("")).toContain("transition-delay: 0ms");
  });

  it("первая фаза в JS тоже схлопывается — лист не ждёт своих 200 мс", () => {
    expect(stageTsx).toMatch(
      /reducedMotion\s*\?\s*sceneMotion\.reducedTransitionMs\s*:\s*CLOSE_PHONE\.grid\.durationMs/u,
    );
    // И окно (сани пана) возвращается теми же 120 мс без задержки.
    expect(panTs).toMatch(/reduced \? sceneMotion\.reducedTransitionMs : CLOSE\.camera\.durationMs/u);
    expect(panTs).toMatch(/reduced \? 0 : CLOSE\.camera\.atMs/u);
  });
});
