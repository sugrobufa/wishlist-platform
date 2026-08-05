import { describe, it, expect } from "vitest";
import { cameraScale, rooms, roomsContract, sceneMotion, toDesktopRect } from "../src/config/design";
import {
  computeZoneCamera,
  frameCoversViewport,
  frameGapAfterZoom,
  frameRect,
  rectToPercent,
  round4,
  sceneSize,
  zoneFramePercent,
  zoneScenePercent,
  type SceneView,
} from "../src/components/scene/camera";
import { visibleZones } from "../src/components/scene/zones";

// Сцена (тикет 02): наезд камеры считается формулой motion.json → openZone[0]
// из прямоугольников rooms.json — руками не задаётся. Если тест упал, кто-то
// тронул формулу или контракт; это баг процесса, а не повод поправить числа.

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`не найдено: ${what}`);
  return value;
}

const cream = must(
  rooms.find((room) => room.id === "cream"),
  "комната cream",
);
const fashion = must(
  cream.zones.find((zone) => zone.key === "fashion"),
  "зона cream/fashion",
);

describe("наезд камеры (формула motion.json → openZone[0])", () => {
  // Пять тестов этого блока переписаны тикетом 20. Прежний эталон повторял
  // формулу контракта буква в букву, включая деление на scale — а браузер
  // умножает translate на scale сам (scale стоит в списке функций снаружи).
  // Эталон был неверен: он «доказывал» ровно тот недоезд, на который пожаловался
  // владелец. Расхождение с контрактом зафиксировано в
  // docs/adr/0002-camera-centering.md, формула motion.json не тронута.

  it("cream/fashion, телефон: контрактная формула, домноженная на scale", () => {
    const { w: sw, h: sh } = roomsContract.scene.phone;
    const scale = cameraScale.phone;
    const r = fashion.rect;
    // Буква контракта: dx = ((sceneW/2 − (x + w/2)) / sceneW) * 100 / scale
    const dxContract = (((sw / 2 - (r.x + r.w / 2)) / sw) * 100) / scale;
    const dyContract = (((sh / 2 - (r.y + r.h / 2)) / sh) * 100) / scale;
    // Код: то же самое, но без деления — иначе браузерное умножение на scale
    // укорачивает сдвиг ровно в scale раз (ADR-0002).
    const dx = dxContract * scale;
    const dy = dyContract * scale;

    const cam = computeZoneCamera(r, "phone");
    expect(cam.scale).toBe(scale);
    expect(cam.dx).toBeCloseTo(dx, 10);
    expect(cam.dy).toBeCloseTo(dy, 10);
    expect(cam.transform).toBe(`scale(${scale}) translate(${round4(dx)}%, ${round4(dy)}%)`);
  });

  it("десктоп: тот же расчёт через фактор 1.7778, без отдельной карты", () => {
    const f = roomsContract.scene.desktop.factorFromPhone;
    const { w: sw, h: sh } = roomsContract.scene.desktop;
    const scale = cameraScale.desktop;
    const imageShift = Math.abs(roomsContract.scene.phone.image.x); // 12

    const r = fashion.rect;
    const x = (r.x + imageShift) * f;
    const y = r.y * f;
    const w = r.w * f;
    const h = r.h * f;
    const dx = ((sw / 2 - (x + w / 2)) / sw) * 100;
    const dy = ((sh / 2 - (y + h / 2)) / sh) * 100;

    const cam = computeZoneCamera(r, "desktop");
    expect(cam.scale).toBe(scale);
    expect(cam.dx).toBeCloseTo(dx, 10);
    expect(cam.dy).toBeCloseTo(dy, 10);
    expect(cam.transform).toBe(`scale(${scale}) translate(${round4(dx)}%, ${round4(dy)}%)`);
  });

  it("translate никогда не превышает полслоя (обе платформы, все 120 зон)", () => {
    // Проценты translate считаются от слоя камеры (он равен вьюпорту), а центр
    // зоны всегда внутри сцены — значит |dx| ≤ 50%. Экранный сдвиг равен
    // dx·scale и может быть больше 50%: он ровно гасит разбегание от scale.
    for (const room of rooms) {
      for (const zone of room.zones) {
        for (const view of ["phone", "desktop"] as const) {
          const cam = computeZoneCamera(zone.rect, view);
          expect(Math.abs(cam.dx), `${room.id}/${zone.key} ${view} dx`).toBeLessThanOrEqual(50);
          expect(Math.abs(cam.dy), `${room.id}/${zone.key} ${view} dy`).toBeLessThanOrEqual(50);
        }
      }
    }
  });

  it("телефон: правый край кадра не обнажается ни у одной из 120 зон", () => {
    // Кадр 630 против сцены 430 — справа запас 200 px, его хватает любой зоне.
    // Слева и снизу запаса нет: там пустоту даёт сама геометрия пакета (ADR-0002).
    for (const room of rooms) {
      for (const zone of room.zones) {
        expect(frameGapAfterZoom(zone.rect, "phone").right, `${room.id}/${zone.key}`).toBe(0);
      }
    }
  });

  it("зона в центральной полосе кадра: после наезда пустоты нет вовсе", () => {
    // Запас на панорамирование даёт слой дрейфа под камерой (scale ≥ 1.10 из
    // motion.json → ambient.drift.amplitude) — он и распарсен в sceneMotion.
    // Зона «Музыка» в bold — та самая, на которой владелец ловил баг.
    const bold = must(
      rooms.find((room) => room.id === "bold"),
      "комната bold",
    );
    const music = must(
      bold.zones.find((zone) => zone.key === "music"),
      "зона bold/music",
    );
    for (const view of ["phone", "desktop"] as const) {
      expect(frameCoversViewport(music.rect, view), `bold/music ${view}`).toBe(true);
    }
    const covered = rooms.flatMap((room) =>
      room.zones.filter((zone) => frameCoversViewport(zone.rect, "phone")),
    );
    expect(covered.length).toBeGreaterThan(rooms.length); // полоса широкая, не вырожденная
  });

  it("партитура распарсена из motion.json (дрейф, покой камеры, reduced motion)", () => {
    expect(sceneMotion.drift.translatePct).toBeCloseTo(1.1, 10);
    expect(sceneMotion.drift.scaleFrom).toBeCloseTo(1.1, 10);
    expect(sceneMotion.drift.scaleTo).toBeCloseTo(1.13, 10);
    expect(sceneMotion.camera.restTransform).toBe("scale(1.02)");
    expect(sceneMotion.reducedTransitionMs).toBe(120);
  });
});

// Позиция хотспота (баг приёмки 18): зона обязана лежать на одном и том же
// участке КАДРА при любой ширине экрана. Карта задана в координатах телефонной
// сцены (430×352), кадр 630×351 стоит в ней со сдвигом x = −12; на телефоне
// видна часть кадра, на десктопе — весь кадр (630 · 1.7778 = 1120).
describe("позиция хотспота (доля кадра, rooms.json)", () => {
  const img = roomsContract.scene.phone.image;
  const allZones = rooms.flatMap((room) =>
    room.zones.map((zone) => ({ id: `${room.id}/${zone.key}`, rect: zone.rect })),
  );

  /** Обратный перевод «проценты сцены вида → доля кадра» — то, что видит глаз. */
  function sceneToFramePercent(p: ReturnType<typeof zoneScenePercent>, view: SceneView) {
    const { w: sw, h: sh } = sceneSize(view);
    const f = frameRect(view);
    return {
      left: (((p.left / 100) * sw - f.x) / f.w) * 100,
      top: (((p.top / 100) * sh - f.y) / f.h) * 100,
      width: (((p.width / 100) * sw) / f.w) * 100,
      height: (((p.height / 100) * sh) / f.h) * 100,
    };
  }

  it("120 зон: доля кадра совпадает с картой ((x+12)/630, y/351)", () => {
    // Раунд 2: в контракте 130 зон, в рендере 120 — `money` спрятана до записи
    // в zones.json (ADR-0003). Прямоугольники всех 130 проверяет design-contract.
    expect(allZones).toHaveLength(120);
    for (const { id, rect } of allZones) {
      const box = zoneFramePercent(rect);
      expect(box.left, `${id} left`).toBeCloseTo(((rect.x - img.x) / img.w) * 100, 3);
      expect(box.top, `${id} top`).toBeCloseTo(((rect.y - img.y) / img.h) * 100, 3);
      expect(box.width, `${id} width`).toBeCloseTo((rect.w / img.w) * 100, 3);
      expect(box.height, `${id} height`).toBeCloseTo((rect.h / img.h) * 100, 3);
    }
  });

  it("телефон и десктоп дают ОДИНАКОВУЮ долю кадра (толеранс ≤1%)", () => {
    for (const { id, rect } of allZones) {
      const phoneOnFrame = sceneToFramePercent(zoneScenePercent(rect, "phone"), "phone");
      const deskOnFrame = sceneToFramePercent(zoneScenePercent(rect, "desktop"), "desktop");
      const map = zoneFramePercent(rect);
      for (const side of ["left", "top", "width", "height"] as const) {
        expect(phoneOnFrame[side], `${id} phone ${side}`).toBeCloseTo(map[side], 2);
        expect(deskOnFrame[side], `${id} desktop ${side}`).toBeCloseTo(map[side], 2);
        expect(Math.abs(phoneOnFrame[side] - deskOnFrame[side]), `${id} расхождение ${side}`)
          .toBeLessThanOrEqual(1);
      }
    }
  });

  it("телефон: поведение прежнее — проценты сцены равны карте как есть", () => {
    // Регресс-щит мобильного вида: до починки телефон считался
    // rectToPercent(rect, "phone") и выглядел верно — эти числа не изменились.
    for (const { id, rect } of allZones) {
      const now = zoneScenePercent(rect, "phone");
      const before = rectToPercent(rect, "phone");
      for (const side of ["left", "top", "width", "height"] as const) {
        expect(now[side], `${id} ${side}`).toBeCloseTo(before[side], 3);
      }
    }
  });

  it("десктоп: множитель 1.7778 и сдвиг кадра применены (эталон toDesktopRect)", () => {
    for (const { id, rect } of allZones) {
      const now = zoneScenePercent(rect, "desktop");
      const expected = rectToPercent(toDesktopRect(rect), "desktop");
      for (const side of ["left", "top", "width", "height"] as const) {
        expect(now[side], `${id} ${side}`).toBeCloseTo(expected[side], 2);
      }
    }
  });

  it("десктоп: зона больше НЕ сидит в телефонном прямоугольнике (баг 18)", () => {
    // До починки хотспот получал проценты телефонной карты от десктопной сцены:
    // все зоны сжимались в 430×352 в левом верхнем углу кадра 1120×625.
    const bold = must(
      rooms.find((room) => room.id === "bold"),
      "комната bold",
    );
    const music = must(
      bold.zones.find((zone) => zone.key === "music"),
      "зона bold/music",
    );
    const { w: sw } = sceneSize("desktop");
    const buggyLeftPx = (rectToPercent(music.rect, "desktop").left / 100) * sw;
    const fixedLeftPx = (zoneScenePercent(music.rect, "desktop").left / 100) * sw;
    expect(buggyLeftPx).toBeCloseTo(music.rect.x, 3); // старое поведение = телефонные px
    expect(fixedLeftPx).toBeCloseTo(
      (music.rect.x - roomsContract.scene.phone.image.x) *
        roomsContract.scene.desktop.factorFromPhone,
      3,
    );
    expect(fixedLeftPx - buggyLeftPx).toBeGreaterThan(300); // проигрыватель уехал вправо
  });

  it("краевые зоны не выходят за кадр ни на одном виде", () => {
    // Телефонная сцена на 1 px выше кадра (352 против 351) — зоны, доходящие
    // до низа сцены, свешиваются ровно на этот пиксель. Это факт контракта,
    // а не промах разметки, поэтому он и есть допуск снизу.
    const bottomSlack = ((roomsContract.scene.phone.h - img.h) / img.h) * 100;
    expect(bottomSlack).toBeLessThan(0.3);
    for (const { id, rect } of allZones) {
      const box = zoneFramePercent(rect);
      expect(box.left, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(box.top, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width, `${id} правый край`).toBeLessThanOrEqual(100);
      expect(box.top + box.height, `${id} нижний край`).toBeLessThanOrEqual(100 + bottomSlack);
      for (const view of ["phone", "desktop"] as const) {
        const onFrame = sceneToFramePercent(zoneScenePercent(rect, view), view);
        expect(onFrame.left, `${id} ${view} left`).toBeGreaterThanOrEqual(-0.01);
        expect(onFrame.left + onFrame.width, `${id} ${view} правый край`).toBeLessThanOrEqual(
          100.01,
        );
        expect(onFrame.top, `${id} ${view} top`).toBeGreaterThanOrEqual(-0.01);
        expect(onFrame.top + onFrame.height, `${id} ${view} нижний край`).toBeLessThanOrEqual(
          100 + bottomSlack + 0.01,
        );
      }
    }
  });
});

describe("выключенные зоны (Room.zonesOff)", () => {
  it("зона из zonesOff не попадает в список рендера", () => {
    const visible = visibleZones(cream.zones, ["perfume", "bags"]);
    const keys = visible.map((zone) => zone.key);
    expect(keys).not.toContain("perfume");
    expect(keys).not.toContain("bags");
    expect(visible).toHaveLength(cream.zones.length - 2);
  });

  it("без zonesOff список полный и порядок сохранён", () => {
    const all = cream.zones.map((zone) => zone.key);
    expect(visibleZones(cream.zones, []).map((zone) => zone.key)).toEqual(all);
    expect(visibleZones(cream.zones, undefined).map((zone) => zone.key)).toEqual(all);
  });

  it("неизвестный ключ в zonesOff игнорируется, исходный массив не мутируется", () => {
    const before = [...cream.zones];
    const visible = visibleZones(cream.zones, ["no-such-zone"]);
    expect(visible).toHaveLength(cream.zones.length);
    expect(cream.zones).toEqual(before);
  });
});
