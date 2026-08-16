// МЕТКИ И УГОЛКИ ДЫШАТ ВМЕСТЕ С КАДРОМ (тикет 259, приёмка владельца
// 16.08.2026: «уголки не попадают в вещи и всё время гуляют при передвижении
// комнаты»).
//
// ЧТО ЗДЕСЬ СТОРОЖИТСЯ. Слой хотспотов лежит снаружи стопки камеры — так и
// задумано, при наезде он скрыт. Но снаружи он оказался и у двух трансформов
// ПОКОЯ, которые кадр везёт всегда: вес камеры (--lead-rest) и дыхание
// (.drift). Пока их не было, метка стояла не там, где предмет, и уезжала с ним
// каждые 15 секунд — незакрытое «Следствие 2» ADR-0002 от 05.08.2026.
//
// Сторож поэтому проверяет ДВЕ вещи, и обе — про совпадение слоёв, а не про
// красоту: покой описан ОДНИМИ И ТЕМИ ЖЕ переменными у кадра и у меток, и
// разница между ними считается числами контракта — она обязана быть нулём.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rooms, scene, sceneMotion } from "../src/config/design";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const stage = read("../src/components/scene/SceneStage.tsx");

/** Правило CSS по имени класса — тело до первой закрывающей скобки. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `правило ${selector} не найдено`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("слой меток повторяет покой кадра (тикет 259)", () => {
  it("обёртка веса камеры берёт ту же переменную, что и .camera", () => {
    const rest = rule(sceneCss, ".hotspotsRest");
    expect(rest).toContain("transform: var(--lead-rest)");
    expect(rest).toContain("transform-origin: var(--cam-origin)");
    // Коробка обязана совпадать со слоем хотспотов, иначе проценты хотспотов
    // станут долей другого прямоугольника.
    expect(rest).toContain("inset: 0");

    // Та же переменная стоит у самой камеры — второй правды о покое нет.
    expect(rule(sceneCss, ".camera")).toContain("transform: var(--lead-rest)");
  });

  it("дыхание у меток — ТОТ ЖЕ класс .drift, а не его копия числами", () => {
    // Класс один на оба слоя: за ним сами едут срез размаха вблизи и
    // prefers-reduced-motion. Копия правил разошлась бы с первой же правкой.
    const uses = stage.match(/s\.drift/gu) ?? [];
    expect(uses.length, "дыхание должно стоять на кадре И на слое меток").toBe(2);
    expect(sceneCss).toContain(".zoomed .drift");
    expect(rule(sceneCss, ".drift")).toContain("animation: drift");
  });

  it("слой меток обёрнут в покой кадра, а не рисует зоны напрямую", () => {
    const layer = stage.indexOf("ref={hotspotsLayerRef}");
    const zonesMap = stage.indexOf("{zones.map(", layer);
    const between = stage.slice(layer, zonesMap);
    expect(between).toContain("s.hotspotsRest");
    expect(between).toContain("s.drift");
    expect(between).toContain("ref={hotspotsFrameRef}");
  });

  it("движок близости меряет от дышащего слоя, а не от неподвижной коробки", () => {
    // Перевод «точка пальца → координата кадра» обязан идти через тот же
    // трансформ, что и картинка: иначе свет разгорается не у той зоны.
    expect(stage).toMatch(/const layer = hotspotsFrameRef\.current \?\? hotspotsLayerRef\.current/u);
  });
});

describe("промах, ради которого правка сделана (ADR-0002, «Следствие 2»)", () => {
  // Модель ровно та же, что в camera-centering: точка кадра уезжает в
  // `o + S·(p − o) + S·t`, где o — центр коробки. У слоя меток до тикета 259
  // S была равна 1, у кадра — вес камеры × дыхание.
  const restScale = Number(/scale\(([\d.]+)\)/u.exec(sceneMotion.camera.restTransform)?.[1]);
  const breath = sceneMotion.drift.scaleFrom;
  const frameW = scene.phone.image.w;
  const center = frameW / 2;

  it("числа покоя читаются из контракта, а не выдуманы тестом", () => {
    expect(restScale).toBeGreaterThan(1);
    expect(breath).toBeGreaterThanOrEqual(1.1);
    expect(sceneMotion.drift.scaleTo).toBeGreaterThan(breath);
  });

  it("без общего покоя метка уезжала с предмета больше чем на плечо уголка", () => {
    const scaleWas = restScale * breath;
    // Худшая зона — самая далёкая от середины кадра по горизонтали.
    const worst = rooms
      .flatMap((room) => room.zones.map((zone) => zone.rect))
      .reduce((max, r) => Math.max(max, Math.abs(r.x + r.w / 2 - center)), 0);
    const missFramePx = (scaleWas - 1) * worst;

    // Плечо уголка — 11 экранных px (places.json → visual.corners.armPx).
    expect(missFramePx).toBeGreaterThan(11);
    // И это только СТАТИЧЕСКАЯ половина: сверху лежал ещё ход дыхания ±1.1%.
    expect((sceneMotion.drift.translatePct / 100) * frameW).toBeGreaterThan(6);
  });

  it("прежний промах — того же порядка, что живой замер ADR (≈9% ширины окна)", () => {
    // ЧТО СЧИТАЕМ: где точка предмета на экране (кадр везёт вес × дыхание) и где
    // была метка (слой не вёз ничего). Разность делим на ширину ОКНА телефона —
    // в этих единицах ADR и записал свои 9.14%.
    //
    // ПОЧЕМУ ЗДЕСЬ НЕТ ПРОВЕРКИ «А ТЕПЕРЬ НОЛЬ». Ноль тут вышел бы из
    // арифметики, в которую оба слоя подставлены одним и тем же числом, —
    // проверялась бы вера, а не код. Совпадение слоёв держат три сторожа выше:
    // одна переменная покоя, один класс дыхания, одна обёртка в разметке.
    const worstShare = Math.max(
      ...[sceneMotion.drift.scaleFrom, sceneMotion.drift.scaleTo].flatMap((breathPhase) =>
        rooms.flatMap((room) =>
          room.zones.map((zone) => {
            const p = zone.rect.x + zone.rect.w / 2;
            const onFrame = center + restScale * breathPhase * (p - center);
            return Math.abs(onFrame - p) / scene.phone.w;
          }),
        ),
      ),
    );
    expect(worstShare).toBeGreaterThan(0.08);
    expect(worstShare).toBeLessThan(0.2);
  });
});
