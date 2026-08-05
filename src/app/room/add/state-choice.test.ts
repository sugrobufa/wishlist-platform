import { describe, expect, it } from "vitest";
import { rooms, scene, zoneCameraScale } from "@/config/design";
import { cropAspect, zoneCrop } from "@/components/scene/zone-crop";
import { stateChoiceMs, stateChoicePanels } from "./state-choice";

// Выбор «люблю / хочу» кропами комнаты (тикет 27, tokens.json → stateChoice).
// Проверяем два места, где легко разъехаться молча: инвариант №3 (пунктир
// кодирует «хочу», а не отсутствие фото) и арифметику кропа — он обязан
// содержать зону целиком, не искажать кадр и не вылезать за его границы.

const img = scene.phone.image;
const allZones = rooms.flatMap((room) =>
  room.zones.map((zone) => ({ id: `${room.id}/${zone.key}`, rect: zone.rect })),
);

// round4 в переводе координат оставляет хвост в сотых доли пикселя.
const EPS = 0.01;

describe("инвариант №3: пунктир — это «хочу», а не отсутствие фото", () => {
  const [love, want] = stateChoicePanels(allZones[0]?.rect ?? null);

  it("призрачный контур есть только у «хочу»", () => {
    expect(love?.state).toBe("LOVE");
    expect(love?.ghost).toBe(false);
    expect(want?.state).toBe("WANT");
    expect(want?.ghost).toBe(true);
  });

  it("нет кропа — «люблю» всё равно без пунктира", () => {
    // Отсутствие картинки не имеет права превратить «люблю» в пунктирную
    // панель: ровно этой ошибкой прототип путал два состояния.
    const [noCropLove, noCropWant] = stateChoicePanels(null);
    expect(noCropLove?.crop).toBeNull();
    expect(noCropLove?.ghost).toBe(false);
    expect(noCropWant?.ghost).toBe(true);
  });

  it("обе панели показывают ОДНО место интерьера — разница только в обработке", () => {
    expect(love?.crop).not.toBeNull();
    expect(love?.crop).toBe(want?.crop);
  });
});

describe("числа контракта", () => {
  it("пропорция кропа и длительность перехода читаются из пакета", () => {
    expect(cropAspect).toBe(1.35);
    expect(stateChoiceMs).toBe(240);
  });
});

describe("кроп зоны из базового кадра", () => {
  it("коробка держит пропорцию 1.35:1 и не выходит за кадр — все 120 зон", () => {
    for (const { id, rect } of allZones) {
      const { box } = zoneCrop(rect);
      expect(box.w / box.h, `${id}: пропорция`).toBeCloseTo(cropAspect, 6);
      expect(box.x, `${id}: левый край`).toBeGreaterThanOrEqual(-EPS);
      expect(box.y, `${id}: верхний край`).toBeGreaterThanOrEqual(-EPS);
      expect(box.x + box.w, `${id}: правый край`).toBeLessThanOrEqual(img.w + EPS);
      expect(box.y + box.h, `${id}: нижний край`).toBeLessThanOrEqual(img.h + EPS);
    }
  });

  it("зона влезает в кроп целиком — даже шкаф во всю стену", () => {
    // Пропорция согласуется расширением коробки вокруг центра зоны, а не
    // растягиванием содержимого: обрезать вещь по пояс нельзя.
    for (const { id, rect } of allZones) {
      const { spot } = zoneCrop(rect);
      expect(spot.left, `${id}: слева`).toBeGreaterThanOrEqual(-EPS);
      expect(spot.top, `${id}: сверху`).toBeGreaterThanOrEqual(-EPS);
      expect(spot.left + spot.width, `${id}: справа`).toBeLessThanOrEqual(100 + EPS);
      expect(spot.top + spot.height, `${id}: снизу`).toBeLessThanOrEqual(100 + EPS);
      expect(spot.width, `${id}: ширина`).toBeGreaterThan(0);
      expect(spot.height, `${id}: высота`).toBeGreaterThan(0);
    }
  });

  it("вокруг вещи остаётся интерьер — кроп не у́же обзора камеры этой зоны", () => {
    // Ширина кропа = «сколько кадра видно, когда камера подошла к зоне»
    // (motion.json → cameraScale). Тесный кроп крошечной зоны превратился бы
    // в мыло: clamp 1.45…2.6 не даёт вырезке стать меньше 165 px кадра.
    for (const { id, rect } of allZones) {
      const { box } = zoneCrop(rect);
      const cameraView = scene.phone.w / zoneCameraScale(rect, "phone");
      expect(box.w, `${id}`).toBeGreaterThanOrEqual(Math.min(cameraView, img.h * cropAspect) - EPS);
    }
  });

  it("центр зоны остаётся в кропе, а у края кадра вырезка вдвигается внутрь", () => {
    for (const { id, rect } of allZones) {
      const { box, spot } = zoneCrop(rect);
      const cx = spot.left + spot.width / 2;
      const cy = spot.top + spot.height / 2;
      expect(cx, `${id}: центр по x`).toBeGreaterThan(0);
      expect(cx, `${id}: центр по x`).toBeLessThan(100);
      expect(cy, `${id}: центр по y`).toBeGreaterThan(0);
      expect(cy, `${id}: центр по y`).toBeLessThan(100);
      expect(box.w, `${id}: ширина коробки`).toBeGreaterThan(0);
    }
  });

  it("масштаб фона равномерный — картинку не растягивает", () => {
    // background-size в процентах коробки: по ширине img.w/w, по высоте
    // img.h/h. При h = w / 1.35 и коробке той же пропорции обе оси дают один
    // масштаб; расхождение значило бы искажённый кадр.
    for (const { id, rect } of allZones) {
      const { size, box } = zoneCrop(rect);
      const parts = size.split(" ").map((part) => Number.parseFloat(part));
      const sx = parts[0] ?? Number.NaN;
      const sy = parts[1] ?? Number.NaN;
      expect(sx, `${id}: size по x`).toBeCloseTo((img.w / box.w) * 100, 3);
      expect(sy, `${id}: size по y`).toBeCloseTo((img.h / box.h) * 100, 3);
      // Экранный масштаб: по x — sx·B/100/img.w, по y — sy·(B/AR)/100/img.h.
      // Равенство сводится к sx·AR·img.h = sy·img.w и не зависит от ширины.
      // Сравниваем отношением: проценты округлены до 4 знаков, абсолютная
      // разница на числах порядка 1e5 — это шум округления, а не растяжение.
      expect((sx * cropAspect * img.h) / (sy * img.w), `${id}: равномерность`).toBeCloseTo(1, 6);
    }
  });
});
