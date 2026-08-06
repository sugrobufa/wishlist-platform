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
// Раунд 7, приёмка 130 кадров «открыто» (2026-08-06, тикет 46). Дизайн снял
// все 130 кадров, но порог приёмки не прогонял — прогнали мы
// (`scripts/check-frames.mjs`, порог `handoff/reshoot-recipe.md`: своя зона
// ≥ 0.05 и ≥ 3× относительно фона). Итог: прошло 12 из 130, и одиннадцать из
// двенадцати — зоны, у которых кадр уже был. Новый годный кадр ровно один.
//
// ЧТО ИЗМЕНИЛОСЬ ПРОТИВ ПРИЁМКИ РАУНДОВ 4–5 (тикет 40):
//   • `accepted` больше НЕ приезжает из пакета. Оба состояния — `accepted` и
//     `reshoot` — ставит наше измерение, и потому вернулось правило
//     `accepted ⟺ openFrame`, а состояний у зоны снова ровно одно. Оба
//     противоречия прежнего контракта (шесть «принято без кадра» и пять
//     «нет предмета, но переснять») тем самым закрыты, а не описаны;
//   • подключено 30 кадров вместо 33: +1 новый (`study/events`, отн 22.9),
//     −4 отключённых. Четыре — кадры прежних раундов, которые НИКОГДА не
//     проходили наш порог: `warm/jewelry` 2.78, `warm/travel` 2.82,
//     `cottage/jewelry` 2.78, `cottage/travel` 1.48 при пороге 3. Их подключил
//     не аудит, а флаг `accepted` из пакета — ровно то, чего мы больше не
//     делаем. Файлы уехали в `refs/legacy/`;
//   • прямоугольники НЕ менялись ни у одной зоны: восемь `placeBased` из
//     пакета не приняты (см. `roomsContract.round7.rectsNotApplied`).
//
// Что осталось с раундов 4–5 и не трогалось: координаты кадра 630×351
// (ADR-0006), 49 переразмеченных зон с `rectOld`, `eyeChecked` на всех 130,
// восемь `objectAbsent`, реестр пересечений, долг по `bloomAR`.
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
// Кадры «открыто»: 30 принятых из 130 — и почему на экране их 26.
//
// Порог приёмки (DESIGN-BRIEF-04, `handoff/reshoot-recipe.md`, считает
// `scripts/check-frames.mjs`): собственный прямоугольник обязан измениться на
// ≥ 0.05 и при этом в ≥ 3 раза сильнее фона. Первое означает «предмет
// действительно изменился», второе — «изменился только он»: продукт делает
// кроссфейд между базовым кадром и «открыто», и поплывший фон читается как
// рывок всей комнаты.
// ---------------------------------------------------------------------------
describe("кадры «открыто» (openFrame — единственный источник истины)", () => {
  const withFrame = allZones.filter(({ zone }) => zone.openFrame);
  const accepted = allZones.filter(({ zone }) => zone.accepted);
  const absent = allZones.filter(({ zone }) => zone.objectAbsent);

  it("кадров «открыто» ровно 30, и столько же с флагом accepted", () => {
    // Счёт кадров по раундам: 49 → 39 (раунд 4 переразметил 35 зон) → 33
    // (раунд 5 исправил ещё 14 прямоугольников) → 30 (раунд 7: +1 новый,
    // −4 никогда не проходивших порог). Флаг и данные снова совпадают,
    // потому что теперь и то и другое ставит наше измерение, а не пакет.
    expect(withFrame).toHaveLength(30);
    expect(accepted).toHaveLength(30);
    expect(absent).toHaveLength(8);
  });

  it("accepted ⟺ openFrame: флаг больше не может разойтись с данными", () => {
    // Это правило дважды ломалось пакетом (раунд 5 оставил шесть «принято без
    // кадра», раунд 7 прислал `accepted: false` у зоны, чей кадр порог прошёл).
    // Оба раза виноват не контракт, а источник флага: его писал тот, кто порог
    // не считал. Теперь пишем мы — и правило снова выполнимо.
    for (const { id, zone } of allZones) {
      expect(Boolean(zone.accepted), `${id}`).toBe(Boolean(zone.openFrame));
    }
    expect(roomsContract.acceptedRule).toMatch(/НАШИМ измерением/u);
  });

  it("четыре кадра отключены приёмкой раунда 7 — с числами прямо в контракте", () => {
    // Они лежали подключёнными с раунда 3, но нашего порога не проходили
    // никогда: их подключил флаг `accepted` из пакета, а не аудит. Сверено с
    // отчётом прежнего прогона (`C:/Wishlist/masters-4k/audit.json`) — числа
    // совпали до третьего знака, то есть дело не в пересжатии кадров.
    const dropped = allZones.filter(({ zone }) => zone.reshootReason?.includes("тикет 46"));
    expect(dropped.map((z) => z.id)).toEqual([
      "warm/jewelry",
      "warm/travel",
      "cottage/jewelry",
      "cottage/travel",
    ]);
    for (const { id, zone } of dropped) {
      expect(zone.openFrame ?? null, `${id}`).toBeNull();
      expect(zone.reshoot, `${id}: ушли в очередь на пересъёмку`).toBe(true);
      expect(zone.reshootReason, `${id}: отношение к фону записано числом`).toMatch(
        /отн \d\.\d+ при пороге 3/u,
      );
    }
    // И файлы уехали из раздачи: иначе продукт показывал бы кадр, который
    // приёмку не прошёл, а имя занял бы будущий кадр после пересъёмки.
    const shipped = new Set(readdirSync(resolve(PKG, "refs")));
    for (const { id, room, zone } of dropped) {
      expect(shipped.has(`o-${room.id}-${zone.key}.jpg`), `${id}: кадр обязан уехать`).toBe(false);
    }
  });

  it("единственный кадр раунда 7: study/events снят против нынешнего прямоугольника", () => {
    // Раунд 7 прислал 130 кадров, порог прошли 12, и одиннадцать из них — те же
    // зоны, что уже подключены (восемь — байт в байт тот же файл). Прибыток
    // ровно один, и он единственный, у кого прямоугольник переразмечен: кадр
    // снят ПОСЛЕ переразметки раунда 5, поэтому правило «у зоны с кадром
    // переразметки быть не может» ему не указ — оно про кадры раунда 3.
    const round7 = withFrame.filter(({ zone }) => zone.frameRound === 7);
    expect(round7.map((z) => z.id)).toEqual(["study/events"]);
    for (const { id, zone } of round7) {
      expect(zone.remappedRound, `${id}: прямоугольник исправлен осмотром раунда 5`).toBe(5);
      expect(zone.rectOld, `${id}: прежний прямоугольник контракт держит`).toBeTruthy();
    }
    expect(roomsContract.round7).toMatchObject({ shot: 130, passedOurThreshold: 12, connected: 1 });
  });

  it("у остальных 29 кадров прямоугольник не двигался с раунда 3 — иначе порог мерили не там", () => {
    // Это правило, из которого и вычитаются отключения: кадр действителен
    // ровно до тех пор, пока прямоугольник тот же, против которого его мерили.
    // `rectOld` — прямоугольник до последней переразметки; если он есть, зона
    // переразмечена, и кадр обязан быть снят заново.
    const round3 = withFrame.filter(({ zone }) => zone.frameRound !== 7);
    expect(round3).toHaveLength(29);
    for (const { id, zone } of round3) {
      expect(zone.rectOld, `${id}: у зоны с кадром переразметки быть не может`).toBeUndefined();
      expect(zone.remappedRound, `${id}`).toBeUndefined();
    }
  });

  it("восемь placeBased-прямоугольников пакета не применены — и это записано", () => {
    // Дизайн переставил их «по месту» (поверхность под шкафом, край стола) и
    // заодно снял `objectAbsent`. Не приняли ни то, ни другое: это одно
    // решение, а не два, и предмета в интерьере от переноса прямоугольника не
    // прибавилось. Расстановка — измерение, а не вкус (CLAUDE.md); мы должны
    // дизайну десять прямоугольников, и эти восемь ждут их.
    expect(roomsContract.round7.rectsNotApplied).toMatch(/placeBased/u);
    for (const address of zonesHiddenByProduct) {
      expect(roomsContract.round7.rectsNotApplied, address).toContain(address);
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
      // Переснимать нечего — предмета в интерьере нет. Раунд 5 держал пять из
      // восьми ещё и в очереди на пересъёмку; приёмка 46 это сняла.
      expect(zone.reshoot, `${id}: в очередь на пересъёмку не ставится`).toBeUndefined();
    }
  });

  it("состояние у зоны ровно одно: 30 + 92 + 8 = 130", () => {
    // Раунд 5 сломал разбиение с двух сторон сразу: шесть зон были «приняты без
    // кадра», пять стояли одновременно в «нет предмета» и «переснять». Обе
    // поломки шли от флагов пакета. Теперь флаги ставит наше измерение, и
    // арифметика снова сходится в одну строку — новый пакет сломает её сразу.
    const reshoot = allZones.filter(({ zone }) => zone.reshoot);
    expect([accepted.length, reshoot.length, absent.length]).toEqual([30, 92, 8]);
    const doubled = allZones.filter(
      ({ zone }) => [zone.accepted, zone.reshoot, zone.objectAbsent].filter(Boolean).length > 1,
    );
    expect(doubled).toEqual([]);
    const stateless = allZones.filter(
      ({ zone }) => !zone.accepted && !zone.reshoot && !zone.objectAbsent,
    );
    expect(stateless).toEqual([]);
    expect(accepted.length + reshoot.length + absent.length).toBe(130);
  });

  it("зона без кадра не обещает раскрытия: ни кадра, ни глагола", () => {
    // Это и есть правило «зона без обещания честнее зоны, открывающейся ничем».
    // Глагол проверяем вместе с кадром: подпись «ящики винила выезжают» у зоны,
    // которая не откроется, — то же самое обещание, только словами.
    for (const { id, zone } of allZones) {
      if (zone.reshoot) expect(zone.openFrame ?? null, `${id}`).toBeNull();
      if (zone.objectAbsent) expect(zone.openFrame ?? null, `${id}`).toBeNull();
      if (zone.openFrame) expect(zone.accepted, `${id}: кадр только у принятых`).toBe(true);
      expect(Boolean(zone.openVerb), `${id}: глагол ровно у зон с кадром`).toBe(
        Boolean(zone.openFrame),
      );
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

  it("на экране 29 раскрытий: 30 кадров контракта − 1 (warm)", () => {
    // ДВА РАЗНЫХ ЧИСЛА, и их легко перепутать между собой:
    //   30 — зон с кадром `openFrame` в контракте, столько же файлов снято;
    //   29 — раскрытий, которые человек может увидеть на экране.
    // Разница 30 → 29 не про качество кадров:
    //   −1  у комнат `warm` и `loft` базовый кадр пакета разошёлся с нынешним
    //       сильнее порога композиции 0.05 — мебель поехала, прямоугольники к
    //       этим кадрам не подходят, поэтому «открыто» у них не подключено
    //       вовсе (ADR-0005). В контракте у них остался один кадр на двоих
    //       (`warm/money`): два кадра `warm` сняла приёмка 46, у `loft` кадров
    //       не осталось ещё после раунда 5.
    // Прежде вычиталось ещё три — кадры скрытой зоны `money`. ADR-0008 зону
    // включил, и на экран вышли `lux/money`, `bold/money`, `cottage/money`:
    // конверт в этих комнатах действительно раскрывается. В остальных камера
    // подъедет к конверту без раскрытия — как у любой зоны без кадра.
    // Осторожно с историей: до раунда 4 контракт давал 49 принятых и ровно 39
    // подключённых, и «39» успело осесть в ADR-0005 как «подключено».
    expect(withFrame).toHaveLength(30);
    const connected = rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.openFrame).map((zone) => `${room.id}/${zone.key}`),
    );
    expect(connected).toHaveLength(29);
    expect(connected.filter((id) => id.startsWith("warm/") || id.startsWith("loft/"))).toEqual([]);
    // Конверт раскрывается ровно в трёх комнатах — в контракте кадров четыре,
    // четвёртый (`warm/money`) уехал вместе со всей комнатой.
    expect(connected.filter((id) => id.endsWith("/money"))).toEqual([
      "lux/money",
      "bold/money",
      "cottage/money",
    ]);
    expect(withFrame.filter(({ room }) => !["warm", "loft"].includes(room.id))).toHaveLength(29);
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

  it("зона money есть в каждой комнате контракта — и теперь в каждой в рендере", () => {
    // Было наоборот: ADR-0004 прятал зону явным списком, потому что за ней не
    // было ни экрана, ни сценария, а единственное, что она обещала, —
    // денежный перевод — запрещено PRD §12а.
    //
    // ADR-0008 (решение владельца 06.08.2026) выполнил условие возврата,
    // записанное там же: внутри зоны — копилка на мечту, деньги идут МИМО
    // сервиса. PRD §12а не изменился, переводов по-прежнему нет.
    // Список исключений по ключу остался пустым и рабочим — следующее такое
    // решение владельца пишется одной строкой.
    expect(zoneKeysHiddenByProduct).toEqual([]);
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
      ).toBe(true);
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

    // 130 − 8 (без предмета) = 122 зоны в рендере. Прежде вычиталось ещё
    // десять — зона `money` во всех комнатах; ADR-0008 её включил.
    const perRoom = Object.fromEntries(rooms.map((room) => [room.id, room.zones.length]));
    expect(perRoom).toEqual({
      cream: 13,
      warm: 12,
      lux: 12,
      emerald: 12,
      bold: 13,
      cottage: 13,
      gamer: 13,
      sport: 11,
      study: 11,
      loft: 12,
    });
    expect(rooms.reduce((n, room) => n + room.zones.length, 0)).toBe(122);
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

  it("в рендере пар столько же: включённая зона money вернула свою пару", () => {
    // Прежде продукт не чувствовал пару `sport/sport×money`: зона `money` не
    // рисовалась вовсе, значит и нажатие у неё было не отнять. ADR-0008 зону
    // включил — пара вернулась в живые, и реестр долга совпадает с рендером
    // строка в строку.
    const shown = rooms.flatMap(overlapsIn).map((o) => `${o.id} (${o.area} px²)`);
    expect(shown).toEqual(OVERLAP_DEBT);
    expect(shown).toHaveLength(15);
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
