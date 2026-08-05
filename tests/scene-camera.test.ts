import { describe, it, expect } from "vitest";
import {
  cameraScale,
  rooms,
  roomsContract,
  sceneMotion,
  toDesktopRect,
  zoneCameraScale,
} from "../src/config/design";
import {
  computeZoneCamera,
  frameCoversViewport,
  frameGapAfterZoom,
  frameRect,
  rectToPercent,
  round4,
  sceneSize,
  walkScaleAt,
  walkScore,
  zoneFramePercent,
  zoneScenePercent,
  type SceneView,
} from "../src/components/scene/camera";
import { visibleZones } from "../src/components/scene/zones";

// Сцена (тикет 02): наезд камеры считается формулой motion.json → openZone
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

describe("наезд камеры (формула motion.json → openZone)", () => {
  // Пять тестов этого блока переписаны тикетом 20. Прежний эталон повторял
  // формулу контракта буква в букву, включая деление на scale — а браузер
  // умножает translate на scale сам (scale стоит в списке функций снаружи).
  // Эталон был неверен: он «доказывал» ровно тот недоезд, на который пожаловался
  // владелец. Расхождение с контрактом зафиксировано в
  // docs/adr/0002-camera-centering.md, формула motion.json не тронута.
  //
  // Тикет 22 поправил в них ДВЕ вещи и ни одного вывода: масштаб теперь
  // считается формулой motion.json (числа rooms.json 1.72/1.45 вне игры), а
  // сдвиг переехал на внешний слой — браузер его масштабом больше не
  // домножает, поэтому множитель scale стоит в расчёте.

  it("cream/fashion, телефон: контрактная формула, домноженная на scale", () => {
    const { w: sw, h: sh } = roomsContract.scene.phone;
    // Масштаб зоны — формула, а не одно число на все зоны (ADR-0003 §2).
    const scale = zoneCameraScale(fashion.rect, "phone");
    const r = fashion.rect;
    // «Доехать до центра» без всяких масштабов: сколько процентов слоя пройти.
    const dxPure = ((sw / 2 - (r.x + r.w / 2)) / sw) * 100;
    const dyPure = ((sh / 2 - (r.y + r.h / 2)) / sh) * 100;
    // Слой сдвига лежит СНАРУЖИ слоя масштаба — экранный сдвиг равен самому
    // translate, поэтому путь домножается на scale руками (тикет 22).
    const dx = dxPure * scale;
    const dy = dyPure * scale;
    // Связь с буквой контракта: там ещё и деление на scale (ADR-0002).
    const dxContract = dxPure / scale;
    expect(dxContract * scale * scale).toBeCloseTo(dx, 10);

    const cam = computeZoneCamera(r, "phone");
    expect(cam.scale).toBe(scale);
    expect(cam.dx).toBeCloseTo(dx, 10);
    expect(cam.dy).toBeCloseTo(dy, 10);
    expect(cam.pan).toBe(`translate(${round4(dx)}%, ${round4(dy)}%)`);
    expect(cam.zoom).toBe(`scale(${round4(scale)})`);
  });

  it("десктоп: тот же расчёт через фактор 1.7778, без отдельной карты", () => {
    const f = roomsContract.scene.desktop.factorFromPhone;
    const { w: sw, h: sh } = roomsContract.scene.desktop;
    // Ширина зоны в формуле масштаба — телефонная на обоих видах (sceneW: 430).
    const scale = zoneCameraScale(fashion.rect, "desktop");
    const imageShift = Math.abs(roomsContract.scene.phone.image.x); // 12

    const r = fashion.rect;
    const x = (r.x + imageShift) * f;
    const y = r.y * f;
    const w = r.w * f;
    const h = r.h * f;
    const dx = ((sw / 2 - (x + w / 2)) / sw) * 100 * scale;
    const dy = ((sh / 2 - (y + h / 2)) / sh) * 100 * scale;

    const cam = computeZoneCamera(r, "desktop");
    expect(cam.scale).toBe(scale);
    expect(cam.dx).toBeCloseTo(dx, 10);
    expect(cam.dy).toBeCloseTo(dy, 10);
    expect(cam.pan).toBe(`translate(${round4(dx)}%, ${round4(dy)}%)`);
  });

  it("сдвиг без масштаба не превышает полслоя (обе платформы, все 120 зон)", () => {
    // Проценты translate считаются от слоя сдвига (он равен вьюпорту), а центр
    // зоны всегда внутри сцены — значит «чистый» путь до центра ≤ 50% слоя.
    // Сам dx теперь больше: он домножен на scale, и это ровно тот множитель,
    // который гасит разбегание от масштаба (раньше его давал браузер).
    for (const room of rooms) {
      for (const zone of room.zones) {
        for (const view of ["phone", "desktop"] as const) {
          const cam = computeZoneCamera(zone.rect, view);
          const id = `${room.id}/${zone.key} ${view}`;
          expect(Math.abs(cam.dx / cam.scale), `${id} dx`).toBeLessThanOrEqual(50);
          expect(Math.abs(cam.dy / cam.scale), `${id} dy`).toBeLessThanOrEqual(50);
        }
      }
    }
  });

  it("масштаб наезда — формула motion.json, числа rooms.json в сцене не участвуют", () => {
    // Критерий тикета 22: cameraScale из rooms.json (1.72/1.45) перестал
    // действовать. Раунд 4 согласился: блок помечен УСТАРЕЛО, ключ `desktop`
    // переименован в `desktopLegacy`, а рядом записан действующий потолок
    // формулы — 2.05 (он же max в motion.json → cameraScale.desktop).
    expect(roomsContract.cameraScale.phone).toBe(1.72);
    expect(roomsContract.cameraScale.desktopLegacy).toBe(1.45);
    expect(roomsContract.cameraScale.desktopCeiling).toBe(
      sceneMotion.cameraScaleFormula.desktop.max,
    );
    expect(roomsContract.cameraScale.note).toMatch(/УСТАРЕЛО/u);
    const widths = new Set<number>();
    for (const room of rooms) {
      for (const zone of room.zones) {
        for (const view of ["phone", "desktop"] as const) {
          const cam = computeZoneCamera(zone.rect, view);
          expect(cam.scale, `${room.id}/${zone.key} ${view}`).toBe(
            zoneCameraScale(zone.rect, view),
          );
        }
        widths.add(zone.rect.w);
      }
    }
    // Зоны шириной от 22 до 269 px — ровно то, из-за чего одно число дизайн
    // назвал ошибкой: узкой зоне нужно другое приближение, чем широкой.
    expect(Math.min(...widths)).toBe(22);
    expect(Math.max(...widths)).toBe(269);
    const narrow = zoneCameraScale({ x: 0, y: 0, w: 22, h: 22 }, "phone");
    const wide = zoneCameraScale({ x: 0, y: 0, w: 269, h: 40 }, "phone");
    expect(narrow).toBeGreaterThan(cameraScale.phone);
    expect(wide).toBeLessThan(cameraScale.phone);
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

// «Походка» (тикет 22): семь фаз партитуры разложены по вложенным слоям, у
// каждого своё время. Тесты держат две вещи: слои дают ровно те абсолютные
// значения, что написаны в openZone, и рассинхрон масштаба со сдвигом — тот
// самый, из-за которого путь выгибается.
describe("походка: разложение openZone по слоям", () => {
  it("масштаб и сдвиг едут РАЗНОЕ время — 620/720 телефон, 700/810 десктоп", () => {
    const phone = walkScore("phone");
    const desktop = walkScore("desktop");
    expect(phone.zoom.durationMs).toBe(620);
    expect(phone.pan.durationMs).toBe(720);
    expect(desktop.zoom.durationMs).toBe(700);
    expect(desktop.pan.durationMs).toBe(810);
    // Разница и есть «голова доворачивается к предмету»: 100 мс на телефоне,
    // 110 на десктопе — ровного числа в контракте нет.
    expect(phone.pan.durationMs - phone.zoom.durationMs).toBe(100);
    expect(desktop.pan.durationMs - desktop.zoom.durationMs).toBe(110);
    // Стартуют одновременно, после переноса веса.
    expect(phone.pan.atMs).toBe(phone.zoom.atMs);
    expect(phone.zoom.atMs).toBe(phone.lead.durationMs);
  });

  it("фаза «вес переносится назад»: 150 мс, scale(1.02) → scale(1.008)", () => {
    const phone = walkScore("phone");
    expect(phone.lead.atMs).toBe(0);
    expect(phone.lead.durationMs).toBe(150);
    expect(phone.lead.rest).toBe("scale(1.02)");
    expect(phone.lead.on).toBe("scale(1.008)");
    // Одинаково на обоих видах — в контракте у фазы одно число.
    expect(walkScore("desktop").lead).toEqual(phone.lead);
  });

  it("перелёт и оседание: 3% вверх кривой walk, возврат кривой settle", () => {
    const phone = walkScore("phone");
    const desktop = walkScore("desktop");
    expect(sceneMotion.walk.scale.overshoot).toBe(1.03);
    expect(phone.settle.atMs).toBe(770);
    expect(desktop.settle.atMs).toBe(850);
    expect(phone.settle.durationMs).toBe(420);
    // Оседание начинается ровно там, где заканчивается шаг масштабом.
    expect(phone.settle.atMs).toBe(phone.zoom.atMs + phone.zoom.durationMs);
    expect(desktop.settle.atMs).toBe(desktop.zoom.atMs + desktop.zoom.durationMs);
    // Кривые — по именам из контракта, не по вкусу.
    expect(phone.lead.easing).toBe(sceneMotion.easingOut);
    expect(phone.zoom.easing).toBe(sceneMotion.easingWalk);
    expect(phone.pan.easing).toBe(sceneMotion.easingWalk);
    expect(phone.settle.easing).toBe(sceneMotion.easingSettle);
    // Вся походка укладывается в 1190 / 1270 мс.
    expect(phone.totalMs).toBe(1190);
    expect(desktop.totalMs).toBe(1270);
  });

  it("произведение слоёв = абсолютные значения контракта во всех узлах", () => {
    // Контракт пишет масштаб камеры одним числом на фазу: 1.02 → 1.008 →
    // target·1.03 → target. Слоёв три, они перемножаются — тест держит именно
    // равенство произведения букве openZone, а не сами множители.
    for (const view of ["phone", "desktop"] as const) {
      for (const room of rooms) {
        for (const zone of room.zones) {
          const target = zoneCameraScale(zone.rect, view);
          const id = `${room.id}/${zone.key} ${view}`;
          expect(walkScaleAt(target, "rest", view), `${id} покой`).toBeCloseTo(1.02, 9);
          expect(walkScaleAt(target, "lead", view), `${id} вес`).toBeCloseTo(1.008, 9);
          expect(walkScaleAt(target, "peak", view), `${id} перелёт`).toBeCloseTo(target * 1.03, 6);
          expect(walkScaleAt(target, "settled", view), `${id} оседание`).toBeCloseTo(target, 6);
        }
      }
    }
  });

  it("вуаль стартует со сдвигом, дыхание вблизи срезано до 45%", () => {
    expect(sceneMotion.veil.delayMs).toBe(90);
    expect(sceneMotion.veil.durationMs).toBe(560);
    expect(sceneMotion.drift.zoomedFactor).toBe(0.45);
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
