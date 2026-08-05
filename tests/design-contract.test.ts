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
  zonesHiddenByProduct,
} from "../src/config/design";

// Контракт дизайн-пакета: эти числа зафиксированы в handoff/README.md.
// Если тест упал — кто-то тронул rooms.json или изображения. Это баг процесса,
// а не повод поправить ожидания.
//
// Раунды 4–5, приём переразметки и осмотра (2026-08-05, тикет 40). Что
// изменилось против первой половины раунда 4 (тикет 33):
//   • ПРЯМОУГОЛЬНИКИ ПЕРЕЕХАЛИ В КООРДИНАТЫ КАДРА 630×351 — были в координатах
//     окна 430. Правая треть кадра перестала быть недоступной разметке, и
//     32 зоны теперь стоят правее правого края телефонного окна. Проекция —
//     ADR-0006, геометрия — tests/immersive-layout.test.ts;
//   • 49 зон переразмечены (35 в раунде 4, 14 в раунде 5), прежние значения
//     контракт держит в `rectOld`; кадров «открыто» осталось 33 из 130;
//   • флаг `verified` УДАЛЁН (он врал названием) — вместо него три:
//     `notClamped` (машина), `eyeChecked` и `wrongTarget` (человек);
//   • `eyeChecked` впервые на всех 130: раунд 5 осмотрел каждую зону;
//   • восемь зон получили `objectAbsent`: предмета нет в интерьере вовсе.
//
// ДВА МЕСТА, ГДЕ КОНТРАКТ САМ СЕБЕ ПРОТИВОРЕЧИТ, и мы верим не флагу, а данным:
// `accepted` остался на шести зонах с `openFrame: null`, а `reshoot` — на пяти
// зонах с `objectAbsent`. Оба расхождения проверяются ниже поимённо, чтобы
// следующий пакет их либо починил, либо объяснил.
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
    const bloom = (r: { w: number; h: number }) =>
      Math.min(120, Math.max(30, Math.round((r.w / r.h) * 58)));
    for (const { id, zone } of allZones) {
      if (zone.rectOld) continue;
      expect(zone.bloomAR, `${id}`).toBe(bloom(zone.rect));
    }
  });

  it("ДОЛГ ДИЗАЙНУ: у 46 переразмеченных зон bloomAR остался от ПРЕЖНЕГО прямоугольника", () => {
    // Раунды 4 и 5 переразметили 49 зон, но форму светового пятна пересчитать
    // забыли: у 46 из них `bloomAR` ровно равен формуле от `rectOld`. Это не
    // мелочь — пятно рисуется по этому числу (тикет 23), и, например, у
    // `emerald/home` прямоугольник из высокого стал широким (67×136 → 52×28),
    // а пятно осталось вертикальным: 30 против 108. Свет ляжет поперёк предмета.
    //
    // Кодом не чиним: bloom — производная контракта, считать её у себя значит
    // завести вторую карту. Держим реестр, чтобы долг был виден и не оброс.
    const bloom = (r: { w: number; h: number }) =>
      Math.min(120, Math.max(30, Math.round((r.w / r.h) * 58)));
    const stale = allZones.filter(({ zone }) => zone.bloomAR !== bloom(zone.rect));
    expect(stale).toHaveLength(46);
    for (const { id, zone } of stale) {
      expect(zone.rectOld, `${id}: расходится только у переразмеченных`).toBeTruthy();
      expect(zone.bloomAR, `${id}: и ровно по прежнему прямоугольнику`).toBe(
        bloom(zone.rectOld as { w: number; h: number }),
      );
    }
    // Три переразмеченные зоны совпали случайно — пропорция не изменилась.
    expect(allZones.filter(({ zone }) => zone.rectOld)).toHaveLength(49);
  });

  it("каждая зона лежит в границах КАДРА 630×351, а не окна 430", () => {
    // Это и есть смена системы координат: раньше здесь стояли габариты
    // телефонной сцены (430×352), и правая треть кадра была разметке
    // недоступна — всё, что физически стояло там, прижималось к x + w = 430.
    // Теперь границей служит сам кадр (`scene.phone.image`), а окно телефона
    // по нему ездит. Разбор — ADR-0006 и handoff/coords-fix.md.
    const img = roomsContract.scene.phone.image;
    for (const { id, zone } of allZones) {
      expect(zone.rect.x, `${id} x`).toBeGreaterThanOrEqual(0);
      expect(zone.rect.y, `${id} y`).toBeGreaterThanOrEqual(0);
      expect(zone.rect.w, `${id} w`).toBeGreaterThan(0);
      expect(zone.rect.h, `${id} h`).toBeGreaterThan(0);
      expect(zone.rect.x + zone.rect.w, `${id} правый край`).toBeLessThanOrEqual(img.w);
    }
    // По вертикали контракт на 1 px шире кадра: сцена 352 против картинки 351,
    // и две зоны нижнего ряда свешиваются ровно на этот пиксель. Факт пакета,
    // а не промах разметки, — поэтому он записан числом, а не допуском.
    const overhang = allZones.filter(({ zone }) => zone.rect.y + zone.rect.h > img.h);
    expect(overhang.map((z) => z.id)).toEqual(["bold/anything", "bold/travel"]);
    for (const { id, zone } of allZones) {
      expect(zone.rect.y + zone.rect.h, `${id} нижний край`).toBeLessThanOrEqual(
        roomsContract.scene.phone.h,
      );
    }
  });

  it("контракт сам говорит, в какой системе заданы прямоугольники", () => {
    // Значения не копируются в код — но и смысл координат тоже приезжает из
    // пакета. Если следующий раунд снова переопределит систему молча, эта
    // строка изменится, и тест покажет её в диффе рядом с числами.
    expect(roomsContract.scene.phone.note).toMatch(/координатах КАДРА 630×351/u);
    expect(roomsContract.scene.phone.note).toMatch(/без слагаемого/u);
    expect(roomsContract.scene.phone.image).toEqual({ w: 630, h: 351, x: -12, y: 0 });
    // 630 · 1.7778 = 1120 — ширина десктопной сцены. Кадр показан целиком,
    // поэтому перевод в десктоп и есть один этот множитель.
    expect(
      roomsContract.scene.phone.image.w * roomsContract.scene.desktop.factorFromPhone,
    ).toBeCloseTo(roomsContract.scene.desktop.w, 1);
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
// Кадры «открыто»: 39 принятых из 130 — и почему на экране их 30.
//
// Порог приёмки (DESIGN-BRIEF-04, `scripts/name-masters.mjs`): собственный
// прямоугольник обязан измениться на ≥ 0.05 и при этом в ≥ 3 раза сильнее фона.
// Первое означает «предмет действительно изменился», второе — «изменился
// только он»: продукт делает кроссфейд между базовым кадром и «открыто», и
// поплывший фон читается как рывок всей комнаты.
// ---------------------------------------------------------------------------
describe("кадры «открыто» (openFrame — единственный источник истины)", () => {
  const withFrame = allZones.filter(({ zone }) => zone.openFrame);
  const accepted = allZones.filter(({ zone }) => zone.accepted);
  const absent = allZones.filter(({ zone }) => zone.objectAbsent);

  it("кадров «открыто» ровно 33 — и это НЕ то же самое, что 39 с флагом accepted", () => {
    // Счёт кадров за два раунда: 49 → 39 (раунд 4 переразметил 35 зон, у
    // десяти из них кадр был принят) → 33 (раунд 5 осмотрел остальные 92 и
    // исправил ещё 14 прямоугольников, шесть из них — у принятых зон).
    // Флаг `accepted` за этим не поспел и остался на 39; `openFrame` — на 33.
    // Верим данным, а не флагу: раскрытие показывается по openFrame.
    expect(withFrame).toHaveLength(33);
    expect(accepted).toHaveLength(39);
    expect(absent).toHaveLength(8);
  });

  it("шесть зон с лживым accepted названы поимённо: флаг есть, кадра нет", () => {
    // Порог им прогоняли против прямоугольника, который в этом же раунде
    // сдвинулся, — то есть против другого участка кадра. Ровно та ошибка, из-за
    // которой в прошлый раз счёт упал с 49 до 39. Контракт сам с флагом не
    // согласен: `openFrame` у всех шести обнулён. Список именной, потому что
    // молчаливое расхождение флага и данных — это то, что мы больше не
    // пропускаем (ADR-0006).
    const lying = accepted.filter(({ zone }) => !zone.openFrame);
    expect(lying.map((z) => z.id)).toEqual([
      "cream/books",
      "gamer/books",
      "gamer/money",
      "sport/money",
      "study/watches",
      "loft/money",
    ]);
    for (const { id, zone } of lying) {
      expect(zone.remappedRound, `${id}: прямоугольник исправлен в раунде 5`).toBe(5);
      expect(zone.reshootReason, `${id}: причина записана`).toMatch(/раунде 5/u);
      // Флаг `reshoot` им тоже не проставили — зона повисла в состоянии
      // «принята, но кадра нет». Отсюда и весь этот именной тест.
      expect(zone.reshoot, `${id}: контракт даже в очередь их не поставил`).toBeUndefined();
    }
    // И их файлы уехали из раздачи: иначе продукт показал бы кадр, снятый не
    // с того места, а имя занял бы будущий кадр после пересъёмки.
    const shipped = new Set(readdirSync(resolve(PKG, "refs")));
    for (const { id, room, zone } of lying) {
      expect(shipped.has(`o-${room.id}-${zone.key}.jpg`), `${id}: кадр обязан уехать`).toBe(false);
    }
  });

  it("у всех 33 кадров прямоугольник не двигался с раунда 3 — иначе порог мерили не там", () => {
    // Это правило, из которого и вычитаются отключения: кадр действителен
    // ровно до тех пор, пока прямоугольник тот же, против которого его мерили.
    // `rectOld` — прямоугольник до последней переразметки; если он есть, зона
    // переразмечена, и кадр обязан быть снят.
    for (const { id, zone } of withFrame) {
      expect(zone.rectOld, `${id}: у зоны с кадром переразметки быть не может`).toBeUndefined();
      expect(zone.remappedRound, `${id}`).toBeUndefined();
    }
  });

  it("восемь зон без предмета: кадра нет и не будет, пока дизайн не дорисует", () => {
    expect(absent.map((z) => z.id)).toEqual([
      "warm/music",
      "lux/music",
      "emerald/beauty",
      "sport/watches",
      "sport/gaming",
      "study/tech",
      "study/gaming",
      "loft/gaming",
    ]);
    for (const { id, zone } of absent) {
      expect(zone.openFrame ?? null, `${id}`).toBeNull();
      expect(zone.eyeChecked, `${id}: человек смотрел`).toBe(true);
      expect(zone.absentNote, `${id}: причина словами`).toBeTruthy();
    }
    // Второе расхождение контракта: пять новых зон помечены ещё и `reshoot`,
    // хотя переснимать нечего — предмета в интерьере нет. Держим поимённо.
    const alsoReshoot = absent.filter(({ zone }) => zone.reshoot);
    expect(alsoReshoot.map((z) => z.id)).toEqual([
      "emerald/beauty",
      "sport/gaming",
      "study/tech",
      "study/gaming",
      "loft/gaming",
    ]);
  });

  it("сумма состояний не сходится: 39 + 88 + 8 = 135 при 130 зонах", () => {
    // Раньше состояние было ровно одно на зону, и это проверялось в лоб.
    // Раунд 5 сломал разбиение с двух сторон сразу, и обе поломки уже названы
    // выше поимённо. Здесь — арифметика целиком, чтобы следующий пакет было
    // видно по одной строке: пять зон в двух состояниях, шесть — «принято без
    // кадра». 39 + 88 + 8 − 5 (двойных) = 130, и ни одна зона не осталась без
    // состояния вовсе.
    const reshoot = allZones.filter(({ zone }) => zone.reshoot);
    expect([accepted.length, reshoot.length, absent.length]).toEqual([39, 88, 8]);
    const doubled = allZones.filter(
      ({ zone }) => [zone.accepted, zone.reshoot, zone.objectAbsent].filter(Boolean).length > 1,
    );
    expect(doubled).toHaveLength(5);
    const stateless = allZones.filter(
      ({ zone }) => !zone.accepted && !zone.reshoot && !zone.objectAbsent,
    );
    expect(stateless).toEqual([]);
    expect(accepted.length + reshoot.length + absent.length - doubled.length).toBe(130);
  });

  it("зона без кадра не обещает раскрытия: reshoot ⟹ openFrame null", () => {
    // Это и есть правило «зона без обещания честнее зоны, открывающейся ничем».
    // Обратное («accepted ⟺ openFrame») было верно до раунда 5 и больше не
    // выполняется — расхождение держит именной тест выше, а не эта строка.
    for (const { id, zone } of allZones) {
      if (zone.reshoot) expect(zone.openFrame ?? null, `${id}`).toBeNull();
      if (zone.objectAbsent) expect(zone.openFrame ?? null, `${id}`).toBeNull();
      if (zone.openFrame) expect(zone.accepted, `${id}: кадр только у принятых`).toBe(true);
    }
  });

  it("имя кадра выводится из данных: refs-2x/<комната>/o-<комната>-<зона>.jpg", () => {
    for (const { room, zone } of withFrame) {
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

  it("на экране 27 раскрытий: 33 кадра контракта − 3 (warm) − 3 (money)", () => {
    // ТРИ РАЗНЫХ ЧИСЛА, и их легко перепутать между собой:
    //   39 — зон с флагом `accepted` (флаг устарел, шесть из них лгут);
    //   33 — зон с кадром `openFrame` в контракте, столько же файлов снято;
    //   27 — раскрытий, которые человек может увидеть на экране.
    // Разница 33 → 27 не про качество кадров:
    //   −3  у комнат `warm` и `loft` базовый кадр пакета разошёлся с нынешним
    //       сильнее порога композиции 0.05 (0.0727 и 0.0685 против 0.029…0.045
    //       у восьми принятых) — мебель поехала, прямоугольники к этим кадрам
    //       не подходят, поэтому «открыто» у них не подключено вовсе (ADR-0005).
    //       У `loft` после раунда 5 кадров не осталось и в контракте;
    //   −3  кадры скрытой зоны `money` (тест ниже: на диске лежат готовыми).
    // Осторожно с историей: до раунда 4 контракт давал 49 принятых и ровно 39
    // подключённых, и «39» успело осесть в ADR-0005 как «подключено».
    expect(withFrame).toHaveLength(33);
    const connected = rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.openFrame).map((zone) => `${room.id}/${zone.key}`),
    );
    expect(connected).toHaveLength(27);
    expect(connected.filter((id) => id.startsWith("warm/") || id.startsWith("loft/"))).toEqual([]);
    expect(connected.filter((id) => id.endsWith("/money"))).toEqual([]);
    expect(
      withFrame.filter(
        ({ room, zone }) => !["warm", "loft"].includes(room.id) && zone.key !== "money",
      ),
    ).toHaveLength(27);
    for (const room of rooms) {
      for (const zone of room.zones) {
        if (!zone.openFrame) continue;
        expect(existsSync(resolve(PKG, zone.openFrame)), zone.openFrame).toBe(true);
      }
    }
  });

  it("кадры скрытой зоны money тоже на диске — флаг можно снять без 404", () => {
    // zoneKeysHiddenByProduct прячет зону, но не выбрасывает её кадры: три
    // оставшихся «money» (не warm, не loft) лежат готовыми. Было пять — раунд 5
    // исправил прямоугольники `gamer/money` и `sport/money`, и их кадры уехали.
    const moneyFrames = withFrame
      .filter(({ room, zone }) => zone.key === "money" && !["warm", "loft"].includes(room.id))
      .map(({ zone }) => framePath(zone.openFrame as string));
    expect(moneyFrames).toHaveLength(3);
    for (const file of moneyFrames) {
      expect(existsSync(resolve(PKG, file)), file).toBe(true);
    }
  });

  it("на именах зон без кадра в refs не лежит ничего", () => {
    // Обратная сторона правила. Кадры прежних раундов звались по той же схеме
    // `o-<комната>-<зона>.jpg` и заняли бы имена, которые контракт отдаст новым
    // кадрам после пересъёмки: продукт молча показал бы старый кадр вместо
    // нового. Поэтому отключённые уезжают в `refs/legacy/` (раздача их не видит —
    // маршрут принимает только плоские имена), а тест сторожит имена.
    const shipped = new Set(readdirSync(resolve(PKG, "refs")));
    for (const { id, room, zone } of allZones) {
      if (zone.openFrame) continue;
      expect(shipped.has(`o-${room.id}-${zone.key}.jpg`), `${id}: кадра быть не должно`).toBe(
        false,
      );
    }
  });

  it("у каждой зоны с кадром в контракте файл есть — включая warm и loft", () => {
    // Проверка появилась вместо обратной. Раньше здесь стояло «у warm и loft
    // файлов быть не должно»: обе комнаты не прошли порог композиции (0.0727 и
    // 0.0685 при пороге 0.05) и остались на кадрах 1200 px.
    //
    // Порог мерил не то. Он сравнивает новый кадр с нынешним, а «нынешний» для
    // этих двух комнат опознавался неверно: у warm за базовый кадр принимался
    // кадр «открыто» для «Цветов» — отсюда и завышенное расхождение. После
    // приёмки раунда 5, где базовый кадр ищется через попиксельную медиану
    // пачки, обе комнаты дают 0.047 и проходят штатно.
    //
    // Прямоугольники на новых кадрах сверены глазами: в loft все 13 стоят на
    // предметах, в warm — все, кроме «Книг» (их шкаф закрыла разросшаяся ваза,
    // это вопрос дизайну). Владелец увидел разницу первым: его комната —
    // «Тихая роскошь», и она единственная оставалась мыльной.
    const shipped = new Set(readdirSync(resolve(PKG, "refs")));
    for (const { id, room, zone } of withFrame) {
      expect(shipped.has(`o-${room.id}-${zone.key}.jpg`), `${id}: кадр обязан лежать`).toBe(true);
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
    }
  });

  it("восемь зон без предмета скрыты адресно, набор комнаты стал своим", () => {
    // Второй список исключений — не по ключу, а по адресу «комната/ключ»:
    // «Музыка» живёт в восьми комнатах и прячется в двух. Это и есть правило,
    // которое предложил дизайн: набор зон зависит от интерьера, а не от пола.
    expect(zonesHiddenByProduct).toEqual([
      "warm/music",
      "lux/music",
      "emerald/beauty",
      "sport/watches",
      "sport/gaming",
      "study/tech",
      "study/gaming",
      "loft/gaming",
    ]);
    // Ровно те же восемь помечены `objectAbsent` в контракте — список в коде
    // не живёт своей жизнью.
    const absent = allZones.filter(({ zone }) => zone.objectAbsent).map((z) => z.id);
    expect([...zonesHiddenByProduct].sort()).toEqual([...absent].sort());

    // 130 − 10 (money) − 8 (без предмета) = 112 зон в рендере.
    const perRoom = Object.fromEntries(rooms.map((room) => [room.id, room.zones.length]));
    expect(perRoom).toEqual({
      cream: 12,
      warm: 11,
      lux: 11,
      emerald: 11,
      bold: 12,
      cottage: 12,
      gamer: 12,
      sport: 10,
      study: 10,
      loft: 11,
    });
    expect(rooms.reduce((n, room) => n + room.zones.length, 0)).toBe(112);
    for (const address of zonesHiddenByProduct) {
      const [roomId, key] = address.split("/");
      expect(
        rooms.find((room) => room.id === roomId)?.zones.some((zone) => zone.key === key),
        address,
      ).toBe(false);
      // А в других комнатах тот же ключ остаётся: прячем адрес, не категорию.
      expect(
        rooms.some((room) => room.id !== roomId && room.zones.some((zone) => zone.key === key)),
        `${key} должен остаться в других комнатах`,
      ).toBe(true);
    }
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
// долга жил здесь до раунда 3. Раунд 3 развёл их с нулевым допуском, реестр
// был удалён. Раунды 4–5 переразметили 49 зон ГЛАЗАМИ, по предметам, и завели
// пересечения заново — 15 пар. Реестр вернулся.
//
// Почему это не «поправить ожидание»: пересекаются НАЖИМАЕМЫЕ области, и в
// перекрытии выигрывает та, что лежит в разметке позже. Человек метит в вазу,
// а попадает в книжный шкаф — молча. Развести обязан дизайн: прямоугольник
// описывает предмет, а два предмета в одном месте не стоят.
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

  /**
   * РЕЕСТР ДОЛГА. Пятнадцать пар, которые завела переразметка раундов 4–5.
   * Список закрытый: новая пара уронит тест, а закрытая — исчезнет из него
   * вместе со строкой. Площадь держим, чтобы было видно, где кромка задела
   * кромку (15 px²), а где предметы наложились всерьёз (7020 px²).
   */
  const OVERLAP_DEBT = [
    "cream/events×flowers (1260 px²)",
    "cream/books×music (15 px²)",
    "warm/home×flowers (2576 px²)",
    "warm/books×flowers (1728 px²)",
    "lux/books×flowers (924 px²)",
    "emerald/books×music (2496 px²)",
    "emerald/books×flowers (5704 px²)",
    "bold/books×flowers (3040 px²)",
    "bold/flowers×home (1380 px²)",
    "cottage/music×home (108 px²)",
    "cottage/travel×home (7020 px²)",
    "gamer/watches×books (344 px²)",
    "sport/sport×money (450 px²)",
    "study/books×music (252 px²)",
    "loft/sport×watches (165 px²)",
  ];

  it("пересечений ровно столько, сколько в реестре долга — ни одного нового", () => {
    expect(contractRooms.flatMap(overlapsIn).map((o) => `${o.id} (${o.area} px²)`)).toEqual(
      OVERLAP_DEBT,
    );
  });

  it("НАХОДКА ДИЗАЙНУ: cream/events посажена в тот же угол, что cream/flowers", () => {
    // Единственная пара во всём контракте с СОВПАДАЮЩИМ началом — 568,148 у
    // обеих. Это не «два предмета рядом», это похоже на скопированную строку:
    // «Цветы» переразметили в раунде 4, «Впечатления» — в раунде 5, и второй
    // достался угол первой. Глазами по кадру `v4-cream` там ваза с пампасной
    // травой, а доска с билетами — левее, примерно 445…580 по кадру.
    // Свой отчёт дизайна это подтверждает: он пишет, что «Впечатления» в
    // четырёх комнатах стояли на зеркале и их переносили НА ДОСКУ С БИЛЕТАМИ
    // (в `study`, `sport` и `loft` перенос удался — проверено глазами).
    const corners = new Map<string, string[]>();
    for (const { id, zone } of allZones) {
      const key = `${zone.rect.x},${zone.rect.y}`;
      corners.set(`${id.split("/")[0]}|${key}`, [
        ...(corners.get(`${id.split("/")[0]}|${key}`) ?? []),
        id,
      ]);
    }
    const shared = [...corners.values()].filter((group) => group.length > 1);
    expect(shared).toEqual([["cream/events", "cream/flowers"]]);
  });

  it("в рендере пар на одну меньше: sport/sport×money гасится скрытой зоной money", () => {
    // Единственная пара, которую продукт не чувствует: `money` не рисуется
    // вовсе, значит и нажатие у неё не отнять. Остальные четырнадцать — живые.
    const shown = rooms.flatMap(overlapsIn).map((o) => `${o.id} (${o.area} px²)`);
    expect(shown).toEqual(OVERLAP_DEBT.filter((pair) => !pair.startsWith("sport/sport×money")));
    expect(shown).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// Флаги проверки прямоугольника (раунды 4–5, handoff/coords-fix.md и
// handoff/eyecheck-round5.md).
//
// Флаг `verified` УДАЛЁН: он врал названием. Стоял он по машинному правилу
// «не попало под обрезку окна», а читался как «дизайн сверил глазами» — и
// расставлен был ровно наоборот, обрезанные зоны числились проверенными.
// Вместо него три флага, у каждого свой источник и своя цена.
// ---------------------------------------------------------------------------
describe("флаги проверки: notClamped / eyeChecked / wrongTarget", () => {
  it("verified не осталось ни у одной зоны и нигде в контракте", () => {
    for (const { id, zone } of allZones) {
      expect(Object.hasOwn(zone, "verified"), `${id}: verified обязан исчезнуть`).toBe(false);
    }
    expect(Object.keys(roomsContract.flags)).not.toContain("verified");
    expect(JSON.stringify(roomsContract)).not.toContain('"verified"');
  });

  it("контракт объясняет каждый флаг словами — и предупреждает про notClamped", () => {
    // Словарь `flags` и есть то, из-за чего флаг разделили на три. Он приезжает
    // из пакета, а не пересказывается в коде.
    expect(roomsContract.flags.notClamped).toMatch(/x \+ w < 400/u);
    expect(roomsContract.flags.notClamped).toMatch(/Ничего не говорит о том, тот ли предмет/u);
    expect(roomsContract.flags.eyeChecked).toMatch(/Человек посмотрел/u);
    expect(roomsContract.flags.wrongTarget).toMatch(/предмет НЕ тот/u);
    // Проза словаря отстала от данных: она уверяет, что eyeChecked «сейчас
    // false везде», а раунд 5 проставил его на всех 130. Держим расхождение
    // видимым, а не подгоняем под него ожидание.
    expect(roomsContract.flags.eyeChecked).toMatch(/Сейчас false везде/u);
    expect(allZones.every(({ zone }) => zone.eyeChecked)).toBe(true);
  });

  it("notClamped — машинное правило прежней системы, снятое с переразмеченных", () => {
    // Правило считалось ДО переразметки, в координатах окна 430. У 49
    // переразмеченных зон (35 в раунде 4, 14 в раунде 5) прямоугольник с тех пор
    // сменился, и контракт снял с них флаг обрезки: они больше не прижаты ни к
    // какому краю. Поэтому у переразмеченных проверяется только это, а машинное
    // правило — у остальных, по их собственному прямоугольнику.
    const remapped = allZones.filter(({ zone }) => zone.remappedRound);
    expect(remapped.filter(({ zone }) => zone.remappedRound === 4)).toHaveLength(35);
    expect(remapped.filter(({ zone }) => zone.remappedRound === 5)).toHaveLength(14);
    for (const { id, zone } of remapped) {
      expect(zone.notClamped, `${id}: после переразметки обрезки нет`).toBe(true);
      expect(zone.rectOld, `${id}: прежний прямоугольник сохранён для сверки`).toBeTruthy();
    }
    for (const { id, zone } of allZones) {
      if (zone.remappedRound) continue;
      expect(Boolean(zone.notClamped), `${id}`).toBe(zone.rect.x + zone.rect.w < 400);
    }
  });

  it("eyeChecked теперь у всех 130 — непроверенных зон не осталось", () => {
    // Главный итог раунда 5. До него смотрели на 38 зон, и из оставшихся 92
    // четырнадцать показывали не тот предмет, а пять — вообще ничего: пересъёмка
    // девятнадцати кадров ушла бы впустую. Машинный `notClamped` этого не ловил
    // и поймать не мог — он про обрезку окна, а не про предмет.
    expect(allZones.filter(({ zone }) => zone.eyeChecked)).toHaveLength(130);
    expect(allZones.filter(({ zone }) => !zone.eyeChecked)).toEqual([]);
  });

  it("14 прямоугольников исправлены осмотром раунда 5", () => {
    const fixed = allZones.filter(({ zone }) => zone.remappedRound === 5);
    expect(fixed.map((z) => z.id)).toEqual([
      "cream/events",
      "cream/books",
      "gamer/watches",
      "gamer/books",
      "gamer/money",
      "sport/sport",
      "sport/events",
      "sport/money",
      "study/watches",
      "study/events",
      "study/money",
      "loft/events",
      "loft/watches",
      "loft/money",
    ]);
    // Закономерность, которую дизайн назвал вслух: Книги, Часы и Деньги в
    // мужских комнатах стояли на пустой стене — настоящие предметы в правой
    // части кадра, куда прежняя система координат размечать не давала.
    // Проверяем это числом: у большинства исправленных зона уехала за 430.
    const toRightThird = fixed.filter(({ zone }) => zone.rect.x + zone.rect.w > 430);
    expect(toRightThird.length).toBeGreaterThanOrEqual(9);
  });

  it("wrongTarget — три зоны, и все три без предмета в интерьере", () => {
    // Флаг остался с раунда 4 и на новые пять `objectAbsent` не распространён:
    // там дизайн не «увидел не тот предмет», а не нашёл предмета вовсе.
    const wrong = allZones.filter(({ zone }) => zone.wrongTarget);
    expect(wrong.map((z) => z.id)).toEqual(["warm/music", "lux/music", "sport/watches"]);
    for (const { id, zone } of wrong) {
      expect(zone.objectAbsent, `${id}`).toBe(true);
    }
  });

  it("следа обрезки в разметке больше нет: правые края дошли до кадра", () => {
    // Прежде во ВСЕХ десяти комнатах максимальный правый край был ровно 430 —
    // это была стена окна, а не край мебели, и по ней зоны и прижимались.
    // Теперь предел — сам кадр, и разметка до него дотягивается.
    const atOldEdge = allZones.filter(({ zone }) => zone.rect.x + zone.rect.w === 430);
    expect(atOldEdge).toEqual([]);
    const rights = contractRooms.map((room) =>
      Math.max(...room.zones.map((zone) => zone.rect.x + zone.rect.w)),
    );
    expect(Math.max(...rights)).toBe(roomsContract.scene.phone.image.w);
    // Правее прежней стены 430 стоит 46 зон — те самые, ради которых система
    // координат и менялась (32 после раунда 4, ещё 14 после осмотра раунда 5).
    // Достижимость — tests/immersive-layout.test.ts.
    const beyondOldEdge = allZones.filter(({ zone }) => zone.rect.x + zone.rect.w > 430);
    expect(beyondOldEdge).toHaveLength(46);
  });
});
