import { describe, it, expect } from "vitest";
import {
  cameraScale,
  rooms,
  roomsContract,
  scene,
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
  zoneRectFor,
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
    // Прямоугольник переводится из координат КАДРА в координаты сцены: кадр
    // стоит в телефонной сцене со сдвигом −12, значит x_сцены = x_кадра − 12
    // (тикет 40, ADR-0006). Раньше карта задавалась прямо в координатах окна и
    // здесь стоял `fashion.rect` как есть.
    const img = roomsContract.scene.phone.image;
    const r = { ...fashion.rect, x: fashion.rect.x + img.x, y: fashion.rect.y + img.y };
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

    const cam = computeZoneCamera(fashion.rect, "phone");
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

    // Тикет 40: слагаемого больше НЕТ. Прямоугольник задан в координатах кадра
    // 630, десктоп показывает кадр целиком от нуля (630 · 1.7778 = 1120), и
    // весь перевод — один множитель. Прежде здесь стояло `(r.x + 12) * f`:
    // это переводило координаты окна в координаты кадра, а теперь сдвинуло бы
    // каждую зону на 21 px вправо (ADR-0006).
    const r = fashion.rect;
    const x = r.x * f;
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

  it("сдвиг без масштаба не выходит за пределы КАДРА (обе платформы, 112 зон)", () => {
    // Проценты translate считаются от слоя сдвига (он равен вьюпорту). Прежде
    // здесь стоял предел «≤ 50% слоя»: центр зоны лежал внутри сцены, потому
    // что карта была в координатах окна и дальше него не заходила.
    //
    // После смены системы координат (тикет 40) центр зоны лежит внутри КАДРА, а
    // кадр шире окна и торчит из него с обеих сторон. Значит и предел другой —
    // он выводится из геометрии пакета, а не назначается числом: путь до центра
    // не больше расстояния от середины сцены до дальнего края кадра.
    // На телефоне это 403 px из 430 (93.7%), на десктопе ровно 50%.
    for (const view of ["phone", "desktop"] as const) {
      const { w, h } = sceneSize(view);
      const f = frameRect(view);
      const limitX = (Math.max(w / 2 - f.x, f.x + f.w - w / 2) / w) * 100;
      const limitY = (Math.max(h / 2 - f.y, f.y + f.h - h / 2) / h) * 100;
      for (const room of rooms) {
        for (const zone of room.zones) {
          const cam = computeZoneCamera(zone.rect, view);
          const id = `${room.id}/${zone.key} ${view}`;
          expect(Math.abs(cam.dx / cam.scale), `${id} dx`).toBeLessThanOrEqual(limitX);
          expect(Math.abs(cam.dy / cam.scale), `${id} dy`).toBeLessThanOrEqual(limitY);
        }
      }
      // И сам предел — тот, что диктует кадр, а не круглое число из головы.
      if (view === "phone") expect(limitX).toBeCloseTo(93.7, 1);
      if (view === "desktop") expect(limitX).toBeCloseTo(50.0, 1);
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
    // Зоны шириной от 18 до 269 px — ровно то, из-за чего одно число дизайн
    // назвал ошибкой: узкой зоне нужно другое приближение, чем широкой.
    // 18 px — конверты `gamer/money` и `sport/money`: до ADR-0008 зона денег
    // не рендерилась, и самой узкой показываемой зоной была 25 px.
    expect(Math.min(...widths)).toBe(18);
    expect(Math.max(...widths)).toBe(269);
    const narrow = zoneCameraScale({ x: 0, y: 0, w: 25, h: 22 }, "phone");
    const wide = zoneCameraScale({ x: 0, y: 0, w: 269, h: 40 }, "phone");
    expect(narrow).toBeGreaterThan(cameraScale.phone);
    expect(wide).toBeLessThan(cameraScale.phone);
  });

  it("телефон: правый край кадра теперь тоже обнажается — у 18 зон правой трети", () => {
    // ЭТО ПЕРЕМЕНА, А НЕ ОСЛАБЛЕНИЕ. Прежде здесь стояло «правый край не
    // обнажается ни у одной зоны», и держалось это на том, что справа лежал
    // нетронутый запас 200 px: кадр 630 против окна 430, а разметка дальше 430
    // не заходила физически. После смены системы координат (тикет 40) в правой
    // трети кадра стоят настоящие предметы и настоящие зоны — и наезд на них
    // обнажает правый край ровно так же, как левый обнажался всегда.
    //
    // Зажим по границам кадра по-прежнему НЕ добавлен (ADR-0002): он сдвигает
    // центр зоны ровно на ту величину, которую прячет, то есть возвращает баг
    // «подошли, а предмета не видно». Смягчает пустоту вуаль (55%) и то, что
    // сверху ложится кадр «открыто».
    const exposed = rooms.flatMap((room) =>
      room.zones
        .filter((zone) => frameGapAfterZoom(zone.rect, "phone").right > 0)
        .map((zone) => ({ id: `${room.id}/${zone.key}`, rect: zone.rect })),
    );
    // Было пятнадцать; ADR-0008 включил зону денег, и конверты правой трети
    // (`gamer/money`, `sport/money`, `loft/money`) добавили к ним три.
    // Тикет 53 увёл `cream/events` из правого угла на стену памяти (рект из
    // rects-fix, 447…493) — правая треть отпустила одну: осталось 17.
    expect(exposed).toHaveLength(17);
    // И все восемнадцать стоят правее прежней стены 430 — то есть там, куда
    // разметка раньше не дотягивалась.
    for (const { id, rect } of exposed) {
      expect(rect.x + rect.w, `${id}`).toBeGreaterThan(430);
    }
    // Левый край обнажается по-прежнему и по той же причине — запаса там нет.
    const left = rooms.flatMap((room) =>
      room.zones.filter((zone) => frameGapAfterZoom(zone.rect, "phone").left > 0),
    );
    expect(left.length).toBeGreaterThan(0);
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
// участке КАДРА при любой ширине экрана. Карта задана в координатах САМОГО
// кадра 630×351 (тикет 40); кадр стоит в телефонной сцене 430×352 со сдвигом
// x = −12, поэтому на телефоне видна его часть, а на десктопе весь кадр
// (630 · 1.7778 = 1120).
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

  it("122 зоны: доля кадра совпадает с картой (x/630, y/351) — без слагаемого", () => {
    // В контракте 130 зон, в рендере 122: восемь скрыты адресно, потому что
    // предмета нет в интерьере (ADR-0006). Зона `money` больше не вычитается —
    // ADR-0008 включил её во всех десяти комнатах.
    // Прямоугольники всех 130 проверяет design-contract.
    //
    // Слагаемого `+12` здесь больше нет: карта УЖЕ в координатах кадра, и доля
    // кадра — это просто деление. Раньше стояло `(rect.x − img.x)`, потому что
    // карта жила в координатах окна.
    expect(allZones).toHaveLength(122);
    for (const { id, rect } of allZones) {
      const box = zoneFramePercent(rect);
      expect(box.left, `${id} left`).toBeCloseTo((rect.x / img.w) * 100, 3);
      expect(box.top, `${id} top`).toBeCloseTo((rect.y / img.h) * 100, 3);
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

  it("ЗНАК: телефонное окно ездит по кадру — x_окна = x_кадра − 12, ровно и всегда", () => {
    // САМЫЙ ВАЖНЫЙ ТЕСТ СМЕНЫ КООРДИНАТ. Ошибка в знаке здесь стоит 24 px
    // кадра, и поймать её больше нечем: центровка от знака не зависит вовсе —
    // зона приедет в середину экрана одинаково аккуратно и не на тот предмет.
    //
    // Прежде тут стоял регресс-щит с обратным смыслом: «проценты сцены равны
    // карте как есть», потому что карта и была в координатах окна. Теперь она
    // в координатах кадра, и щит проверяет ровно СДВИГ: минус 12, не плюс.
    const shiftPx = 12;
    expect(img.x).toBe(-shiftPx);
    for (const { id, rect } of allZones) {
      const now = zoneScenePercent(rect, "phone");
      const expectedLeftPx = rect.x - shiftPx;
      expect((now.left / 100) * scene.phone.w, `${id} left px`).toBeCloseTo(expectedLeftPx, 2);
      // По вертикали кадр не сдвинут (image.y = 0), там перевод тождественный.
      expect((now.top / 100) * scene.phone.h, `${id} top px`).toBeCloseTo(rect.y, 2);
      // Размер зоны от переноса не меняется — двигается начало, не масштаб.
      const before = rectToPercent(rect, "phone");
      expect(now.width, `${id} width`).toBeCloseTo(before.width, 3);
      expect(now.height, `${id} height`).toBeCloseTo(before.height, 3);
      // И сдвиг именно ВЛЕВО: зона стоит левее, чем её координата в кадре.
      expect(now.left, `${id} сдвиг влево`).toBeLessThan(before.left);
    }
    // То же самое через `zoneRectFor` — тот путь, которым ходит камера.
    for (const { id, rect } of allZones) {
      expect(zoneRectFor(rect, "phone").x, `${id}`).toBe(rect.x - shiftPx);
      expect(zoneRectFor(rect, "phone").y, `${id}`).toBe(rect.y);
    }
  });

  it("ЗНАК: десктоп — чистый множитель, слагаемого нет", () => {
    // Обратная сторона того же: на десктопе кадр показан целиком и от нуля,
    // поэтому зона в координатах кадра переводится ОДНИМ множителем. Если
    // `+12` вернётся, каждая зона уедет вправо на 21 px, и это тоже пройдёт
    // мимо центровки.
    const f = roomsContract.scene.desktop.factorFromPhone;
    for (const { id, rect } of allZones) {
      expect(toDesktopRect(rect).x, `${id} x`).toBeCloseTo(rect.x * f, 9);
      expect(toDesktopRect(rect).y, `${id} y`).toBeCloseTo(rect.y * f, 9);
      expect(zoneRectFor(rect, "desktop").x, `${id}`).toBeCloseTo(rect.x * f, 9);
    }
    // Зона у левого края кадра садится ровно в ноль десктопной сцены.
    const atLeft = allZones.filter(({ rect }) => rect.x === 0);
    expect(atLeft.length).toBeGreaterThan(0);
    for (const { id, rect } of atLeft) {
      expect(toDesktopRect(rect).x, `${id}`).toBe(0);
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
      music.rect.x * roomsContract.scene.desktop.factorFromPhone,
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
