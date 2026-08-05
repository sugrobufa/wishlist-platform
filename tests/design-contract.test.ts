import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  framePath,
  rooms,
  roomsContract,
  zoneInfo,
  zoneKeysHiddenByProduct,
  zoneKeysWithoutCatalogEntry,
} from "../src/config/design";

// Контракт дизайн-пакета: эти числа зафиксированы в handoff/README.md.
// Если тест упал — кто-то тронул rooms.json или изображения. Это баг процесса,
// а не повод поправить ожидания.
//
// Раунд 4 (2026-08-05, тикет 33). Что изменилось против раунда 2:
//   • у зоны появились флаги `accepted` / `reshoot` — результат нашей же
//     числовой приёмки кадров, который дизайн внёс прямо в контракт: 49 зон
//     с кадром «открыто», 81 без него (`openFrame: null`);
//   • пересечений прямоугольников больше нет — реестр долга на 14 пар удалён;
//   • `zones.json` дописан ключом `money`, поэтому дырок в справочнике нет;
//   • зона `money` при этом не рендерится — но уже по решению ВЛАДЕЛЬЦА
//     (PRD §12а), а не из-за контракта. Отсюда 130 в контракте и 120 в продукте;
//   • `verified` сменил смысл на машинное «не попало под обрезку» (x + w < 400),
//     рядом появился `clamped` на 36 зонах.
//
// Проверяем СЫРОЙ контракт (roomsContract.rooms, все 130), а не то, что
// рендерит продукт: разница между ними — предмет отдельных блоков ниже.
const contractRooms = roomsContract.rooms;

/** Все зоны контракта с адресом вида "cream/fashion" — для внятных падений. */
const allZones = contractRooms.flatMap((room) =>
  room.zones.map((zone) => ({ id: `${room.id}/${zone.key}`, room, zone })),
);

const PKG = resolve(__dirname, "../design/package");

describe("design handoff contract", () => {
  it("10 комнат", () => {
    expect(contractRooms).toHaveLength(10);
  });

  it("130 зон суммарно, по 13 в каждой комнате", () => {
    const total = contractRooms.reduce((n, room) => n + room.zones.length, 0);
    expect(total).toBe(130);
    for (const room of contractRooms) {
      expect(room.zones.length, `${room.id}: 12 зон набора + деньги`).toBe(13);
    }
  });

  it("ключи зон внутри комнаты не повторяются", () => {
    for (const room of contractRooms) {
      const keys = room.zones.map((zone) => zone.key);
      expect(new Set(keys).size, `${room.id}: ${keys.join(",")}`).toBe(keys.length);
    }
  });

  it("у каждой комнаты есть roomLightness в диапазоне 0…1", () => {
    for (const room of contractRooms) {
      expect(typeof room.roomLightness, `${room.id}`).toBe("number");
      expect(room.roomLightness, `${room.id}`).toBeGreaterThanOrEqual(0);
      expect(room.roomLightness, `${room.id}`).toBeLessThanOrEqual(1);
    }
  });

  it("у каждой зоны есть bloomAR (30…120) и bloomRot", () => {
    for (const { id, zone } of allZones) {
      expect(typeof zone.bloomAR, `${id} bloomAR`).toBe("number");
      expect(zone.bloomAR, `${id} bloomAR`).toBeGreaterThanOrEqual(30);
      expect(zone.bloomAR, `${id} bloomAR`).toBeLessThanOrEqual(120);
      expect(typeof zone.bloomRot, `${id} bloomRot`).toBe("number");
      expect(Number.isFinite(zone.bloomRot), `${id} bloomRot`).toBe(true);
    }
  });

  it("bloomAR выведен из w/h по формуле пакета (AR = w/h · 58, зажим 30…120)", () => {
    // tokens.json → zoneMarker.bloom.ellipseAspect.default. Форма светового
    // пятна не размечается руками — она считается из прямоугольника, поэтому
    // расхождение значит, что кто-то правил числа мимо скрипта дизайна.
    for (const { id, zone } of allZones) {
      const expected = Math.min(120, Math.max(30, Math.round((zone.rect.w / zone.rect.h) * 58)));
      expect(zone.bloomAR, `${id}`).toBe(expected);
    }
  });

  it("каждая зона лежит в границах телефонной сцены 430×352", () => {
    const { w, h } = roomsContract.scene.phone;
    for (const { id, zone } of allZones) {
      expect(zone.rect.x, `${id} x`).toBeGreaterThanOrEqual(0);
      expect(zone.rect.y, `${id} y`).toBeGreaterThanOrEqual(0);
      expect(zone.rect.w, `${id} w`).toBeGreaterThan(0);
      expect(zone.rect.h, `${id} h`).toBeGreaterThan(0);
      expect(zone.rect.x + zone.rect.w, `${id} правый край`).toBeLessThanOrEqual(w);
      expect(zone.rect.y + zone.rect.h, `${id} нижний край`).toBeLessThanOrEqual(h);
    }
  });

  it("tokens.css сгенерирован из tokens.json и содержит базовые токены", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    expect(css).toContain("--color-surface-app-ground");
    expect(css).toContain("--color-text-primary");
    expect(css).toContain("--font-display");
    // Раунд 2: блоки, на которые опираются тикеты 23 (метки), 24 (раскладка), 27 (выбор).
    expect(css).toContain("--zone-bloom-rest");
    expect(css).toContain("--zone-vignette-weight");
    expect(css).toContain("--imm-top-veil");
    expect(css).toContain("--state-choice-ar");
  });
});

// ---------------------------------------------------------------------------
// Кадры «открыто»: 49 принятых из 130 — и почему в продукте их 44.
//
// Порог приёмки (DESIGN-BRIEF-04, `scripts/name-masters.mjs`): собственный
// прямоугольник обязан измениться на ≥ 0.05 и при этом в ≥ 3 раза сильнее фона.
// Первое означает «предмет действительно изменился», второе — «изменился
// только он»: продукт делает кроссфейд между базовым кадром и «открыто», и
// поплывший фон читается как рывок всей комнаты.
// ---------------------------------------------------------------------------
describe("кадры «открыто» (accepted / reshoot)", () => {
  const accepted = allZones.filter(({ zone }) => zone.accepted);
  const reshoot = allZones.filter(({ zone }) => zone.reshoot);

  it("49 принятых, 81 к пересъёмке, третьего состояния нет", () => {
    expect(accepted).toHaveLength(49);
    expect(reshoot).toHaveLength(81);
    expect(accepted.length + reshoot.length).toBe(130);
    for (const { id, zone } of allZones) {
      expect(Boolean(zone.accepted) !== Boolean(zone.reshoot), `${id}: ровно один флаг`).toBe(true);
    }
  });

  it("кадр обещан ровно у принятых зон: accepted ⟺ openFrame", () => {
    // Это и есть правило «зона без обещания честнее зоны, открывающейся ничем».
    for (const { id, zone } of allZones) {
      expect(Boolean(zone.openFrame), `${id} openFrame`).toBe(Boolean(zone.accepted));
      if (zone.reshoot) expect(zone.openFrame ?? null, `${id}`).toBeNull();
    }
  });

  it("имя кадра выводится из данных: refs-2x/<комната>/o-<комната>-<зона>.jpg", () => {
    for (const { room, zone } of accepted) {
      expect(zone.openFrame, `${room.id}/${zone.key}`).toBe(
        `refs-2x/${room.id}/o-${room.id}-${zone.key}.jpg`,
      );
    }
  });

  it("базовые кадры всех десяти комнат лежат в design/package/refs", () => {
    for (const room of contractRooms) {
      const file = framePath(room.base);
      expect(existsSync(resolve(PKG, file)), file).toBe(true);
    }
  });

  it("39 кадров «открыто» подключены: 49 принятых − 5 (warm, loft) − 5 (money)", () => {
    // Пять принятых зон остались без кадра: у комнат `warm` и `loft` базовый
    // кадр пакета разошёлся с нынешним сильнее порога композиции 0.05
    // (0.0727 и 0.0685 против 0.029…0.045 у восьми принятых) — мебель поехала,
    // и прямоугольники к этим кадрам не подходят. Разбор — ADR-0005.
    // Ещё пять принятых кадров лежат у скрытой зоны `money` (тест ниже).
    const connected = rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.openFrame).map((zone) => `${room.id}/${zone.key}`),
    );
    expect(connected).toHaveLength(39);
    expect(connected.filter((id) => id.startsWith("warm/") || id.startsWith("loft/"))).toEqual([]);
    for (const room of rooms) {
      for (const zone of room.zones) {
        if (!zone.openFrame) continue;
        expect(existsSync(resolve(PKG, zone.openFrame)), zone.openFrame).toBe(true);
      }
    }
  });

  it("кадры скрытой зоны money тоже на диске — флаг можно снять без 404", () => {
    // zoneKeysHiddenByProduct прячет зону, но не выбрасывает её кадры: пять
    // принятых «money» (кроме warm и loft) лежат готовыми.
    const moneyFrames = accepted
      .filter(({ room, zone }) => zone.key === "money" && !["warm", "loft"].includes(room.id))
      .map(({ zone }) => framePath(zone.openFrame as string));
    expect(moneyFrames).toHaveLength(5);
    for (const file of moneyFrames) {
      expect(existsSync(resolve(PKG, file)), file).toBe(true);
    }
  });

  it("на именах непринятых зон в refs не лежит ничего", () => {
    // Обратная сторона правила. Кадры прежних раундов звались по той же схеме
    // `o-<комната>-<зона>.jpg` и заняли бы имена, которые контракт отдаст новым
    // кадрам после пересъёмки: продукт молча показал бы старый кадр вместо
    // нового. Поэтому прежние 30 уехали в `refs/legacy/` (раздача их не видит —
    // маршрут принимает только плоские имена), а тест сторожит имена.
    const shipped = new Set(readdirSync(resolve(PKG, "refs")));
    for (const { id, room, zone } of reshoot) {
      expect(shipped.has(`o-${room.id}-${zone.key}.jpg`), `${id}: кадра быть не должно`).toBe(
        false,
      );
    }
    // И у warm с loft — тоже: их принятые зоны кадра не получили.
    for (const { id, room, zone } of accepted.filter(({ room }) =>
      ["warm", "loft"].includes(room.id),
    )) {
      expect(shipped.has(`o-${room.id}-${zone.key}.jpg`), `${id}: кадра быть не должно`).toBe(
        false,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Справочник зон (zones.json) и то, что продукт из него показывает.
// ---------------------------------------------------------------------------
describe("справочник зон (zones.json)", () => {
  it("справочник покрывает все 130 ключей контракта — дырок больше нет", () => {
    // Раунды 2–3 жили с дыркой `money`: ключа в справочнике не было, и зона
    // пряталась сама собой (ADR-0003). Раунд 4 ключ дописал.
    const missing = [
      ...new Set(allZones.filter(({ zone }) => !zoneInfo(zone.key)).map(({ zone }) => zone.key)),
    ];
    expect(missing).toEqual([]);
    expect(zoneKeysWithoutCatalogEntry).toEqual([]);
  });

  it("зона money есть в каждой комнате контракта и ни в одной — в рендере", () => {
    // Теперь это решение владельца, а не следствие дырки: PRD §12а «деньги
    // через сервис не ходят никогда». Платежей нет ни в какой фазе, экрана
    // складчины нет, пула демо-вещей нет — человек нажал бы на конверт и
    // упёрся в пустоту. Снимается решением владельца, одним списком в
    // src/config/design.ts.
    expect(zoneKeysHiddenByProduct).toEqual(["money"]);
    for (const room of contractRooms) {
      expect(
        room.zones.some((zone) => zone.key === "money"),
        `${room.id}`,
      ).toBe(true);
    }
    for (const room of rooms) {
      expect(
        room.zones.some((zone) => zone.key === "money"),
        `${room.id}`,
      ).toBe(false);
      expect(room.zones).toHaveLength(12);
    }
    expect(rooms.reduce((n, room) => n + room.zones.length, 0)).toBe(120);
  });

  it("у зоны money свой пул и подпись из справочника — но показывать нечего", () => {
    expect(zoneInfo("money")?.pool).toBe("money");
    expect(zoneInfo("money")?.label).toBe("Просто деньги");
    for (const room of contractRooms) {
      expect(room.zones.find((zone) => zone.key === "money")?.pool, `${room.id}`).toBe("money");
    }
  });
});

// ---------------------------------------------------------------------------
// Пересечения прямоугольников. Раунд 2 их обещал ноль, а было 14 пар — реестр
// долга на 14 пар жил здесь до раунда 3. Раунд 3 развёл их с нулевым допуском
// (прежняя проверка дизайна шла с допуском 8 px и пропускала кромки), реестр
// удалён. Проверка осталась как щит: новое пересечение уронит тест.
// ---------------------------------------------------------------------------
describe("пересечения прямоугольников зон", () => {
  /** Попарное пересечение зон одной комнаты: адрес и площадь наложения в px². */
  function overlapsIn(room: (typeof contractRooms)[number]): { id: string; area: number }[] {
    const found: { id: string; area: number }[] = [];
    for (const [i, first] of room.zones.entries()) {
      for (const second of room.zones.slice(i + 1)) {
        const a = first.rect;
        const b = second.rect;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0) {
          found.push({ id: `${room.id}/${first.key}×${second.key}`, area: ox * oy });
        }
      }
    }
    return found;
  }

  it("ни одной пересекающейся пары во всех 130 зонах", () => {
    expect(contractRooms.flatMap(overlapsIn).map((o) => `${o.id} (${o.area} px²)`)).toEqual([]);
  });

  it("в рендере (120 зон, без money) их тоже ноль", () => {
    expect(rooms.flatMap(overlapsIn)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Обрезка правого края (раунд 4, handoff/coords-fix.md).
//
// Прямоугольники заданы в координатах ОКНА 430, а кадр шириной 630 сдвинут на
// −12: правая треть кадра в окно не попадает, и зоны, физически стоящие там,
// при разметке прижались к x + w = 430. Дизайн пометил их `clamped: true` и
// переразметит сам — кодом мы это не чиним и координаты не трогаем.
// ---------------------------------------------------------------------------
describe("обрезка правого края (clamped)", () => {
  it("36 зон помечены clamped, 94 — нет", () => {
    expect(allZones.filter(({ zone }) => zone.clamped)).toHaveLength(36);
    expect(allZones.filter(({ zone }) => !zone.clamped)).toHaveLength(94);
  });

  it("verified теперь машинное «не попало под обрезку»: verified ⟺ x + w < 400", () => {
    // Прежний смысл флага («дизайн сверил глазами») был расставлен наоборот:
    // обрезанные зоны стояли проверенными, точные — нет. Новое правило хотя бы
    // проверяемо, и мы его проверяем.
    for (const { id, zone } of allZones) {
      expect(Boolean(zone.verified), `${id}`).toBe(zone.rect.x + zone.rect.w < 400);
      expect(Boolean(zone.clamped), `${id}`).toBe(!zone.verified);
    }
  });

  it("правый край ровно 430 у 19 зон — след самой обрезки", () => {
    const atEdge = allZones.filter(({ zone }) => zone.rect.x + zone.rect.w === 430);
    expect(atEdge).toHaveLength(19);
    // И ни в одной комнате нет зоны правее: 430 — это стена окна, а не кадра.
    for (const room of contractRooms) {
      const right = Math.max(...room.zones.map((zone) => zone.rect.x + zone.rect.w));
      expect(right, `${room.id}`).toBe(430);
    }
  });

  it("26 обрезанных зон ждут пересъёмки, 10 обрезанных кадр всё же прошли", () => {
    // Числа из handoff/coords-fix.md. Десять принятых обрезанных зон —
    // те, где предмет случайно попал и в окно тоже.
    const clamped = allZones.filter(({ zone }) => zone.clamped);
    expect(clamped.filter(({ zone }) => zone.reshoot)).toHaveLength(26);
    expect(clamped.filter(({ zone }) => zone.accepted)).toHaveLength(10);
  });
});
