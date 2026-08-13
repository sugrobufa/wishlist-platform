// ЖИВАЯ ПОЛКА БЕЗ МЕСТА НА КАДРЕ — третье состояние зоны (тикет 235).
//
// ОТКУДА. Пакет 50 (`handoff/round50/zones-eight.json` → `proposedState`)
// предложил сменить значение `objectAbsent`, решение владельца 14.08.2026:
// «вариант дизайнера, когда камера не наезжает; она на данном этапе закрывает
// эту дырку». До этого зона без предмета в интерьере пряталась целиком: 404, а
// её вещи уезжали в «Что угодно» — то есть человек менял интерьер и терял полку
// вместе с вещами (приёмка 14.08, замечание 7).
//
// ТРИ СОСТОЯНИЯ, И 404 ОСТАЛАСЬ У ОДНОГО:
//   1. обычная полка — прямоугольник есть: метка горит, камера наезжает;
//   2. живая полка без места на кадре (`zonesWithoutRect`) — страница 200, вещи
//      на месте, добавление работает; нет ровно двух вещей: метки и наезда;
//   3. выключенная хозяйкой (`Room.zonesOff`) — исчезает вместе с мебелью,
//      404 (инвариант №5). Плюс рабочая дверь `zonesHiddenByProduct` — там же
//      404, и сегодня за ней стоят адреса, которым тикет 234 меряет
//      прямоугольники.
//
// ПОЧЕМУ ТЕСТ ЧИТАЕТ ИСХОДНИКИ СТРАНИЦ. Серверные компоненты Next в юните не
// рендерятся (сессия, БД, кэш), а решение «200 или 404» принимается одной
// строкой в каждой из них. Поэтому поведение проверяется там, где оно живёт, —
// на правиле (`visibleZones` / `sceneZones` над справочником), — а разметка
// сторожится тем, что страница зовёт именно это правило и не заводит второго.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  rooms,
  roomsContract,
  zoneHiddenByProduct,
  zoneNotOnFrame,
  zonesHiddenByProduct,
  zonesWithoutRect,
  zoneWithoutRect,
} from "../src/config/design";
import { sceneZones, visibleZones, zonePosition } from "../src/components/scene/zones";
import { emptyPlaces } from "../src/components/scene/empty-places";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const zonePage = read("../src/app/room/zone/[zone]/page.tsx");
const itemPage = read("../src/app/room/zone/[zone]/i/[id]/page.tsx");
const ownerList = read("../src/app/room/list/page.tsx");
const guestRoom = read("../src/app/r/[slug]/page.tsx");
const guestList = read("../src/app/r/[slug]/list/page.tsx");
const guestService = read("../src/server/services/guest-room.ts");
const itemsService = read("../src/server/services/items.ts");
const stage = read("../src/components/scene/SceneStage.tsx");
const zoneIndex = read("../src/components/scene/zone-index.tsx");
const zoneListRail = read("../src/components/scene/zone-list.tsx");

/** Адреса из `zonesWithoutRect`, которые уже есть в контракте (у `bar` зоны ещё нет). */
const live = zonesWithoutRect
  .map((address) => {
    const [roomId, key] = address.split("/") as [string, string];
    return { address, roomId, key };
  })
  .filter(({ roomId, key }) =>
    roomsContract.rooms.some(
      (room) => room.id === roomId && room.zones.some((zone) => zone.key === key),
    ),
  );

const presetOf = (roomId: string) => {
  const room = rooms.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error(`пресета ${roomId} нет в справочнике`);
  return room;
};

describe("полка есть, места на кадре нет", () => {
  it("проверять есть что: адреса живые, а не пустой список", () => {
    // Пустой список сделал бы зелёным весь файл, ничего не проверив.
    expect(live.length).toBeGreaterThanOrEqual(4);
    expect(live.map(({ address }) => address)).toContain("emerald/beauty");
  });

  it("полка остаётся в пресете и помечена флагом", () => {
    for (const { address, roomId, key } of live) {
      const zone = presetOf(roomId).zones.find((candidate) => candidate.key === key);
      expect(zone, `${address}: полка выброшена из пресета`).toBeDefined();
      expect(zone?.withoutRect, address).toBe(true);
      expect(zoneWithoutRect(roomId, key), address).toBe(true);
      // Это НЕ «скрыта продуктом»: два списка разведены и путать их нельзя.
      expect(zoneHiddenByProduct(roomId, key), `${address}: попала в дверь 404`).toBe(false);
      expect(zoneNotOnFrame(roomId, key), address).toBe(true);
    }
  });

  it("в кадре её нет: сцена и указатель зон её не берут", () => {
    for (const { address, roomId, key } of live) {
      const preset = presetOf(roomId);
      expect(visibleZones(preset.zones, []).map((zone) => zone.key), address).toContain(key);
      expect(sceneZones(preset.zones, []).map((zone) => zone.key), address).not.toContain(key);
      // Ровно на одну полку меньше — остальные на месте, а не «заодно ушли».
      expect(sceneZones(preset.zones, []).length, address).toBe(
        visibleZones(preset.zones, []).length - 1,
      );
    }
    // Указатель зон и его десктопный близнец строят список тем же правилом:
    // номер пункта = номер метки в кадре, и дыр в нумерации не бывает.
    expect(zoneIndex).toContain("sceneZones(zones, zonesOff)");
    expect(zoneListRail).toContain("sceneZones(zones, zonesOff)");
    expect(zoneIndex).not.toContain("visibleZones(");
    expect(zoneListRail).not.toContain("visibleZones(");
  });

  it("наезда нет: активной такая зона стать не может", () => {
    // Камера считается от `activeZone.rect`, а `activeZone` ищется в списке
    // СЦЕНЫ — значит зона без места на кадре не станет активной ни из метки
    // (её нет), ни из указателя (её там нет), ни восстановлением фокуса.
    expect(stage).toContain("const zones = useMemo(() => sceneZones(preset.zones, zonesOff)");
    expect(stage).toContain("zones.find((zone) => zone.key === activeKey)");
    expect(stage).toContain("zoomedIn ? computeZoneCamera(activeZone.rect, view) : null");
    // Второго списка зон у сцены нет — иначе метка вернулась бы с чёрного хода.
    expect(stage).not.toContain("visibleZones(");
  });

  it("номера полок не едут через дыру: «полка N из M» считает метки кадра", () => {
    for (const { address, roomId, key } of live) {
      const preset = presetOf(roomId);
      // У самой полки номера нет: места в кадре у неё нет, называть нечего.
      expect(zonePosition(preset.zones, [], key), address).toBeNull();
      // А у соседей номера подряд и без пропусков, и всего их — сколько меток.
      const scene = sceneZones(preset.zones, []);
      for (const [index, zone] of scene.entries()) {
        expect(zonePosition(preset.zones, [], zone.key), `${roomId}/${zone.key}`).toEqual({
          index: index + 1,
          total: scene.length,
        });
      }
    }
  });

  it("место из тройки на неё не встаёт (пакет 50 → threePlaces.hiddenZoneExcluded)", () => {
    // Полное правило и сверка с контрактом — в tests/empty-places.test.ts;
    // здесь результат на живом пресете, с той стороны, где живёт этот тикет.
    for (const { address, roomId, key } of live) {
      const places = emptyPlaces(presetOf(roomId).zones).places.map((place) => place.key);
      expect(places, `${address}: уголок ведёт в никуда`).not.toContain(key);
    }
  });
});

describe("страница зоны отвечает 200, а 404 остаётся за выключенной", () => {
  // Правило страницы — одна строка: `visibleZones(preset.zones, zonesOff)`
  // и `notFound()`, если ключа там нет. Её и проверяем: сперва то, что страница
  // зовёт именно её, потом — что правило отвечает.
  it("страница ищет зону среди ВСЕХ полок комнаты, а не среди меток кадра", () => {
    expect(zonePage).toContain("visibleZones(preset.zones, room.zonesOff).find((z) => z.key === zoneKey)");
    expect(zonePage).not.toContain("sceneZones(");
    // Единственный отказ по зоне — этот. Второго «а если без прямоугольника»
    // в странице нет и появиться не должно.
    expect(zonePage.match(/notFound\(\)/gu) ?? []).toHaveLength(2); // пресет + зона
  });

  it("живая полка находится (200), выключенная хозяйкой — нет (404)", () => {
    for (const { address, roomId, key } of live) {
      const preset = presetOf(roomId);
      const found = visibleZones(preset.zones, []).find((zone) => zone.key === key);
      expect(found, `${address}: страница ответила бы 404`).toBeDefined();
      // Хозяйка выключила полку — она исчезает вместе с мебелью (инвариант №5).
      expect(
        visibleZones(preset.zones, [key]).find((zone) => zone.key === key),
        `${address}: выключенная полка осталась доступной`,
      ).toBeUndefined();
    }
  });

  it("адрес, скрытый продуктом, по-прежнему 404 — его нет в пресете вовсе", () => {
    expect(zonesHiddenByProduct.length).toBeGreaterThan(0);
    for (const address of zonesHiddenByProduct) {
      const [roomId, key] = address.split("/") as [string, string];
      const preset = presetOf(roomId);
      expect(
        visibleZones(preset.zones, []).find((zone) => zone.key === key),
        `${address}: скрытая адресно зона стала доступной`,
      ).toBeUndefined();
    }
  });

  it("миниатюры полки у неё нет: показывать в кадре нечего", () => {
    // Прямоугольник в контракте у неё лежит, но он стоит «по месту», а не по
    // предмету: вырезка 76×48 сказала бы «вот твоя полка» про пустую
    // поверхность.
    expect(itemPage).toContain(
      "const zoneRect = presetZone?.withoutRect ? null : (presetZone?.rect ?? null);",
    );
    expect(itemPage).toContain("zoneRect={zoneRect}");
  });
});

describe("переезд без потерь: вещь не пропадает с экрана", () => {
  /**
   * Правило `rooms.changeRoomPreset` дословно: вещи, чей ключ зоны не встретился
   * в НОВОМ пресете, переезжают в «Что угодно». Пресет здесь тот же `rooms`,
   * что и в сервисе, — второго справочника в продукте нет.
   */
  const movedToAnything = (from: string, to: string, itemZones: readonly string[]) => {
    const keys = presetOf(to).zones.map((zone) => zone.key);
    expect(presetOf(from).zones.map((zone) => zone.key)).toContain(itemZones[0]);
    return itemZones.filter((zone) => !keys.includes(zone));
  };

  it("вещь с полки без места на кадре переезжает во ВСЕ комнаты её пола и остаётся на полке", () => {
    // То, ради чего владелец всё и просил: «лёгкий переезд во все комнаты без
    // потерь». Раньше вещь из `cream/beauty` при переезде в изумрудную комнату
    // уезжала в «Что угодно» — полка там была скрыта. Теперь полка на месте.
    let checked = 0;
    for (const { address, roomId, key } of live) {
      const home = presetOf(roomId);
      for (const other of rooms) {
        if (other.id === roomId) continue;
        // Только комнаты, где эта полка вообще есть по контракту (набор
        // мужских и женских комнат разный — решение владельца про «Бар и табак»).
        const inContract = roomsContract.rooms
          .find((room) => room.id === other.id)
          ?.zones.some((zone) => zone.key === key);
        if (!inContract) continue;
        checked += 1;
        expect(movedToAnything(other.id, roomId, [key]), `${other.id} → ${address}`).toEqual([]);
        expect(movedToAnything(roomId, other.id, [key]), `${address} → ${other.id}`).toEqual([]);
      }
      expect(home.zones.some((zone) => zone.key === key), address).toBe(true);
    }
    expect(checked, "ни одной пары комнат не проверено").toBeGreaterThan(0);
  });

  it("ни одна вещь не пропадает с экрана: списки комнаты берут ВСЕ полки", () => {
    // Метки у полки нет — значит списки и есть её единственная дорога. Все три
    // (комната хозяйки списком, комната гостя списком, полоса под кадром)
    // ходят по `visibleZones`, а не по зонам сцены.
    expect(ownerList).toContain("visibleZones(preset.zones, room.zonesOff)");
    expect(guestList).toContain("visibleZones(preset.zones, room.zonesOff)");
    expect(guestRoom).toContain("visibleZones(preset.zones, room.zonesOff)");
    // Гостю вещи такой полки отдаёт сервис — тем же правилом.
    expect(guestService).toContain("visibleZones(preset.zones, room.zonesOff)");
    // Заголовок группы в списке ведёт на страницу полки — вход, о котором
    // говорит контракт («через список зон комнаты»).
    expect(ownerList).toContain('zoneHrefBase="/room/zone/"');
  });

  it("на такую полку можно положить вещь: она в видимых зонах комнаты", () => {
    // `createItem` отказывает с ZONE_NOT_VISIBLE всему, чего нет в видимых
    // зонах пресета, а считает их по тому же справочнику.
    expect(itemsService).toContain("function visibleZoneKeys(");
    expect(itemsService).toContain("(room?.zones ?? []).filter((zone) => !off.has(zone.key))");
    expect(itemsService).toContain('throw new CreateItemError("ZONE_NOT_VISIBLE"');
    for (const { address, roomId, key } of live) {
      const keys = presetOf(roomId).zones.map((zone) => zone.key);
      expect(keys, `${address}: вещь на неё не положить`).toContain(key);
    }
  });
});
