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
// ПРОСМОТР ГЛАЗАМИ (2026-08-06, тикет 49) — 30 кадров стали 7.
//
// Порог локальности мерит, что изменение произошло внутри прямоугольника. Он
// НЕ мерит, что изменение — это обещанное действие: у каждой зоны есть
// `openVerb` («шкатулка поднимает крышку»), и подпись эту человек видит на
// экране (`zoneVerb` → `ZonePanel`). Владелец нажал на шкатулку в «Изумруде» —
// вместо неё появились косметические палетки; кадр стоял `accepted: true`.
//
// Поэтому все 30 подключённых пар «базовый ↔ открыто» просмотрены глазами по
// вырезкам (`.scratch/design-round-7/identity-check/`), вопрос к каждой один:
// делает ли кадр ровно то, что обещает глагол, с тем же предметом и тем же
// содержимым. Честных оказалось семь. Отключены 23: 17 подмен предмета или
// окружения, 3 пропажи содержимого (половина одежды исчезла со штанги),
// 3 кадра без действия (сменился только свет). Числа и причина у каждой зоны
// лежат в контракте (`reshootReason`, «тикет 49»), сводка — `identityCheck`.
// Пустое обещание раскрытия хуже его отсутствия, а раунд 8 переснимает всё.
//
// РАУНД 8, ПАРТИЯ «КРЕМОВАЯ» (2026-08-06, тикет 53) — 13 кадров, подключено 0.
//
// База партии оказалась НЕ нашим файлом (sha256 разошлись, 2400×1340 против
// наших 2800, l1 0.0327 — то же число, что у базы раунда 7), при README,
// утверждающем «правка от байт-в-байт продуктовой базы». Порог против базы
// партии прошли 5 из 13, против чистой базы (медиана 13 кадров) 6, против
// нашей базы — той пары, что кроссфейдится, — 1. Глаза по всем 13: 5 честных,
// 6 подмен (включая две подмены ОКРУЖЕНИЯ — стёрты проигрыватель `music` и
// банка-копилка `money`), 2 без действия. Подключать кадры, снятые не с нашей
// базы, нельзя: каждое раскрытие мигало бы всей комнатой (фон 0.056–0.078).
// Сводка — `roomsContract.round8`, вердикт дизайну — design/ANSWERS-cream-round8.md.
// Из партии в контракт вошли: два прямоугольника rects-fix (`cream/events`,
// `cream/money` — дизайн подтвердил, «восемь да»), пять глаголов движения в
// zones.json и девятнадцатый пул `grooming`.
//
// Что осталось с раундов 4–5 и не трогалось: координаты кадра 630×351
// (ADR-0006), `eyeChecked` на всех 130, восемь `objectAbsent`, реестр
// пересечений, долг по `bloomAR`.
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

  it("ДОЛГ ДИЗАЙНУ: у 45 переразмеченных зон bloomAR остался от ПРЕЖНЕГО прямоугольника", () => {
    // Раунды 4 и 5 переразметили 49 зон, но форму светового пятна пересчитать
    // забыли: у 46 из них `bloomAR` ровно равен формуле от `rectOld`. Это не
    // мелочь — пятно рисуется по этому числу (тикет 23), и, например, у
    // `emerald/home` прямоугольник из высокого стал широким (67×136 → 52×28),
    // а пятно осталось вертикальным: 30 против 108. Свет ляжет поперёк предмета.
    //
    // Кодом не чиним: bloom — производная контракта, считать её у себя значит
    // завести вторую карту. Держим реестр, чтобы долг был виден и не оброс.
    //
    // Раунд 8 (тикет 53) переразметил `cream/events` и `cream/money` по
    // подтверждённому rects-fix и пересчитал им bloomAR по формуле пакета —
    // долг не повторён, поэтому 46 стало 45: events из реестра вышла. Сверка
    // замеров 06.08 добавила третью — `cream/beauty` (пункт 12 rects-fix,
    // прямоугольник стоял на зеркале): bloomAR пересчитан там же, 97 → 77.
    //
    // Тем же вечером `cottage/music` ВЫШЛА из реестра. Её прямоугольник стоял
    // на деревянном сундуке ПОД проигрывателем — нажатие на «Музыку» вело в
    // мебель; переставлен на сам проигрыватель, bloomAR пересчитан 100 → 120.
    // Поэтому 45 стало 44.
    const bloom = (r: { w: number; h: number }) =>
      Math.min(120, Math.max(30, Math.round((r.w / r.h) * 58)));
    const stale = allZones.filter(({ zone }) => zone.bloomAR !== bloom(zone.rect));
    expect(stale).toHaveLength(44);
    for (const { id, zone } of stale) {
      expect(zone.rectOld, `${id}: расходится только у переразмеченных`).toBeTruthy();
      expect(zone.bloomAR, `${id}: и ровно по прежнему прямоугольнику`).toBe(
        bloom(zone.rectOld as { w: number; h: number }),
      );
    }
    // 49 зон раундов 4–5 плюс cream/money и cream/beauty раунда 8 (у
    // cream/events rectOld был и раньше — раунд 5, теперь хранит прямоугольник,
    // снятый раундом 8). Раунд 11 добавил ещё две — `study/travel` и
    // `loft/travel` (тикет 63): 51 стало 53. Раунд 13 (тикет 75) добавил
    // четыре — `study/sneakers`, `study/anything`, `loft/sneakers`,
    // `loft/fashion`: 53 стало 57 (у двух зон travel rectOld уже был и просто
    // обновился). В реестр долга bloomAR никто из них НЕ попал, и он остался
    // 44: всем шести пятно пересчитано по формуле пакета вместе с
    // прямоугольником.
    // Тикет 81 добавил три: `bold/anything`, `gamer/anything`, `loft/anything`
    // переразмечены по диагнозу дизайна раунда 14 (жест вне нашего ректа),
    // обрезанному до куска без пересечений. 57 стало 60.
    // Тикет 81-2 добавил пять: `gamer/sneakers` (стоял на пустом проёме ниши,
    // переставлен на обувь), `lux/jewelry` (стоял на голой столешнице),
    // `lux/money` (наполовину на зеркальном отражении бокса), `lux/music`
    // (objectAbsent, ужата, чтобы уступить полосу крышке кейса) и `lux/travel`
    // (поднят на раскрытый кейс). `gamer/anything` переразмечен вторично —
    // `rectOld` у него уже был. 60 стало 65.
    expect(allZones.filter(({ zone }) => zone.rectOld)).toHaveLength(65);
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
    // Свешивалась и `bold/anything`; тикет 81 переразметил её по предмету
    // (была во всю ширину кадра, 269 единиц) — свешиваться перестала.
    expect(overhang.map((z) => z.id)).toEqual(["bold/travel"]);
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
// Кадры «открыто»: 7 принятых из 130 — и все семь видны на экране.
//
// ДВЕ ПРОВЕРКИ, и они разные.
//
// 1. Порог локальности (DESIGN-BRIEF-04, `handoff/reshoot-recipe.md`, считает
//    `scripts/check-frames.mjs`): собственный прямоугольник обязан измениться
//    на ≥ 0.05 и при этом в ≥ 3 раза сильнее фона. Первое означает «предмет
//    действительно изменился», второе — «изменился только он»: продукт делает
//    кроссфейд между базовым кадром и «открыто», и поплывший фон читается как
//    рывок всей комнаты.
//
// 2. Совпадение с обещанием (тикет 49) — только глазами. Порог по построению
//    не отличает «шкатулку открыли» от «шкатулку заменили косметикой»: и то и
//    другое локально. Автоматике здесь верить нельзя (`.scratch/STATE.md`,
//    «чему НЕ верить» §1), поэтому вердикт на каждую из 30 пар вынесен
//    просмотром, а кольцо в `check-frames.mjs` осталось флагом для глаза.
// ---------------------------------------------------------------------------
describe("кадры «открыто» (openFrame — единственный источник истины)", () => {
  const withFrame = allZones.filter(({ zone }) => zone.openFrame);
  const accepted = allZones.filter(({ zone }) => zone.accepted);
  const absent = allZones.filter(({ zone }) => zone.objectAbsent);

  it("кадров «открыто» ровно 10, и столько же с флагом accepted", () => {
    // Счёт кадров по раундам: 49 → 39 (раунд 4 переразметил 35 зон) → 33
    // (раунд 5 исправил ещё 14 прямоугольников) → 30 (раунд 7: +1 новый,
    // −4 никогда не проходивших порог) → 7 (тикет 49: −23 по просмотру
    // глазами) → 10 (партия 2 «Кремовой»: +4, из них travel — замена кадра
    // раунда 3, гасившего банку-копилку). Флаг и данные совпадают, потому что
    // и то и другое ставит наше измерение, а не пакет.
    // Раунды 14–15 (тикет 81) прибавили семь: 10 → 17. Шесть из партии
    // раунда 14 (warm/travel, emerald/travel, cottage/travel,
    // cottage/anything, lux/anything, study/anything) и loft/travel из
    // раунда 15. Все сняты от НАШИХ баз 2800×1563 — первая партия, где база
    // не спорит; два приняты глазами ниже порога 3.0 решением владельца.
    // Тикет 81-2 прибавил восьмой из партии раунда 14 — `lux/travel`: кадр был
    // честным с самого начала, но мерился против прямоугольника, который стоял
    // НИЖЕ жеста (0.93). После переразметки соседей (jewelry, money, music)
    // и подъёма самого travel на раскрытый кейс — 3.31. 17 стало 18.
    // Раунд 16 (тикет 87) привёз девятнадцатый — `warm/anything`, пересъёмку по
    // нашему заданию 13: жест СОДЕРЖИМЫМ (бумага разошлась, виден плед), а не
    // крышкой, которую два прежних дубля двигали впустую. Наш замер 2.94 —
    // порог не взят, принят глазами по той же планке, что 2.77 и 2.96.
    expect(withFrame).toHaveLength(19);
    expect(accepted).toHaveLength(19);
    expect(absent).toHaveLength(8);
    expect(withFrame.map((z) => z.id).sort()).toEqual(
      [
        // Раунды 3–8: пять комнат.
        "cream/anything",
        "cream/flowers",
        "cream/home",
        "cream/travel",
        "gamer/travel",
        "sport/anything",
        "sport/sneakers",
        "sport/travel",
        "study/events",
        "study/sport",
        // Раунд 14 — первая партия от наших баз (тикет 81).
        "cottage/anything",
        "cottage/travel",
        "emerald/travel",
        "lux/anything",
        "lux/travel",
        "study/anything",
        "warm/travel",
        // Раунд 15.
        "loft/travel",
        // Раунд 16.
        "warm/anything",
      ].sort(),
    );
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
    // Было четыре; двум из них (`warm/travel`, `cottage/travel`) раунд 14
    // привёз честный кадр, и вердикт тикета 46 у них перезаписан приёмкой —
    // актуальная причина у зоны ровно одна. Остались две.
    expect(dropped.map((z) => z.id)).toEqual(["warm/jewelry", "cottage/jewelry"]);
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

  it("у остальных 6 кадров прямоугольник не двигался с раунда 3 — иначе порог мерили не там", () => {
    // Это правило, из которого и вычитаются отключения: кадр действителен
    // ровно до тех пор, пока прямоугольник тот же, против которого его мерили.
    // `rectOld` — прямоугольник до последней переразметки; если он есть, зона
    // переразмечена, и кадр обязан быть снят заново.
    const byRound: Record<string, number> = {};
    for (const { zone } of withFrame)
      byRound[zone.frameRound ?? "r3"] = (byRound[zone.frameRound ?? "r3"] ?? 0) + 1;
    // 5 раунда 3 (без поля), 1 раунда 7, 4 партии 2 раунда 8.
    // 5 раунда 3 (без поля), 1 раунда 7, 4 партии 2 раунда 8,
    // 6 раунда 14 и 1 раунда 15 (тикет 81), плюс седьмой раунда 14 —
    // `lux/travel` подключён тикетом 81-2 после переразметки соседей,
    // и 1 раунда 16 — `warm/anything` (тикет 87).
    expect(byRound).toEqual({ r3: 5, "7": 1, "8": 4, "14": 7, "15": 1, "16": 1 });
    const round3 = withFrame.filter(({ zone }) => zone.frameRound === undefined);
    expect(round3).toHaveLength(5);
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

  it("состояние у зоны ровно одно: 7 + 115 + 8 = 130", () => {
    // Раунд 5 сломал разбиение с двух сторон сразу: шесть зон были «приняты без
    // кадра», пять стояли одновременно в «нет предмета» и «переснять». Обе
    // поломки шли от флагов пакета. Теперь флаги ставит наше измерение, и
    // арифметика снова сходится в одну строку — новый пакет сломает её сразу.
    // Тикет 49 передвинул 23 зоны из «принято» в «переснять»: 92 → 115;
    // партия 2 «Кремовой» вернула четыре обратно: 115 → 112.
    const reshoot = allZones.filter(({ zone }) => zone.reshoot);
    // Раунды 14–15 вернули семь зон из «переснять» в «принято»: 112 → 105,
    // 10 → 17. Сумма по-прежнему 130.
    // Тикет 81-2 вернул восьмую — `lux/travel`: 105 → 104, 17 → 18. `lux/jewelry`
    // осталась в «переснять», хотя предмета в интерьере нет: перевод в
    // objectAbsent скрыл бы зону вместе с вещами, это решение владельца.
    // Раунд 16 вернул девятую — `warm/anything`: 104 → 103, 18 → 19.
    expect([accepted.length, reshoot.length, absent.length]).toEqual([19, 103, 8]);
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

  it("на экране все 7 раскрытий: разрыв между контрактом и рендером закрылся", () => {
    // ДВА РАЗНЫХ ЧИСЛА, которые прежде расходились и их легко было перепутать:
    //   7 — зон с кадром `openFrame` в контракте, столько же файлов лежит;
    //   7 — раскрытий, которые человек может увидеть на экране.
    // Раньше разница была: у комнат `warm` и `loft` базовый кадр пакета
    // разошёлся с нынешним сильнее порога композиции 0.05 — мебель поехала,
    // прямоугольники к этим кадрам не подходят, поэтому «открыто» у них не
    // подключено вовсе (ADR-0005). Единственный кадр `warm` (`warm/money`)
    // сняла приёмка 49: конверт там подменён шкатулкой с украшениями. Правило
    // про `warm`/`loft` осталось в силе и сторожится ниже — просто вычитать
    // ему больше нечего.
    // ПРАВИЛО «У warm И loft КАДРОВ НЕТ» ОТМЕНЕНО раундами 14–15 (тикет 81):
    // `warm/travel` и `loft/travel` сняты от наших баз и приняты. Прежде оно
    // держалось не как запрет, а как факт — у этих комнат просто не было ни
    // одного честного кадра. Теперь есть, и вычитать больше нечего.
    // Тикет 81-2 добавил `lux/travel`: 17 → 18; раунд 16 — `warm/anything`,
    // второй кадр комнаты warm: 18 → 19.
    expect(withFrame).toHaveLength(19);
    const connected = rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.openFrame).map((zone) => `${room.id}/${zone.key}`),
    );
    expect(connected).toHaveLength(19);
    expect(connected.filter((id) => id.startsWith("warm/") || id.startsWith("loft/")).sort()).toEqual(
      ["loft/travel", "warm/anything", "warm/travel"],
    );
    for (const room of rooms) {
      for (const zone of room.zones) {
        if (!zone.openFrame) continue;
        expect(existsSync(resolve(PKG, zone.openFrame)), zone.openFrame).toBe(true);
      }
    }
  });

  it("у зоны money кадров не осталось: конверт нигде не светится честно", () => {
    // ADR-0008 вывел зону на экран, и до тикета 49 у неё было три кадра
    // (`lux/money`, `bold/money`, `cottage/money`) плюс `warm/money` в
    // контракте. Просмотр глазами снял все четыре: ни на одном конверт не
    // светится — вместо него зеркальная карусель с косметикой (`lux`), банка
    // с гирляндой и второй конверт из ниоткуда (`bold`), ряд бутылей вместо
    // посылки (`cottage`), шкатулка с украшениями (`warm`). Камера к конверту
    // подъедет, раскрытия не обещает — как у любой зоны без кадра.
    const moneyFrames = withFrame.filter(({ zone }) => zone.key === "money");
    expect(moneyFrames).toEqual([]);
    for (const { id, zone } of allZones.filter(({ zone }) => zone.key === "money")) {
      expect(zone.openVerb ?? null, `${id}: обещания без кадра не бывает`).toBeNull();
    }
  });

  it("19 кадров сняты просмотром тикета 49 — с классом и причиной у каждого", () => {
    // Порог локальности их пропустил by design: он мерит, что изменение
    // случилось внутри прямоугольника, а не что это и есть обещанное действие.
    // `emerald/jewelry` прошёл его с запасом (своя 0.3473, фон 0.0763,
    // отн 4.55) — и подменил шкатулку косметикой.
    //
    // Тикет 49 снял 23; у четырёх из них (`cream/fashion`, `cream/jewelry`,
    // `cream/bags`, `cream/anything`) причина с тех пор ПЕРЕЗАПИСАНА приёмкой
    // партии раунда 8 (тикет 53, блок ниже) — актуальный вердикт у зоны ровно
    // один. Здесь остаются 19 неперемеренных.
    // Было 19; двум из них (`cottage/anything`, `lux/anything`) раунд 14 привёз
    // честный кадр, и вердикт тикета 49 у них перезаписан приёмкой — актуальная
    // причина у зоны ровно одна. Осталось 17.
    const dropped = allZones.filter(({ zone }) => zone.reshootReason?.includes("тикет 49"));
    expect(dropped).toHaveLength(17);
    const byClass = (klass: string) =>
      dropped.filter(({ zone }) => zone.reshootReason?.startsWith(klass)).map((z) => z.id);
    // Было 15; `cottage/anything` и `lux/anything` ушли — раунд 14 дал им
    // честный кадр, и старый вердикт «подмена» перезаписан приёмкой.
    expect(byClass("подмена")).toHaveLength(13);
    expect(byClass("пропажа")).toEqual(["gamer/fashion", "sport/fashion"]);
    expect(byClass("действия нет")).toEqual(["emerald/bags", "bold/bags"]);
    for (const { id, zone } of dropped) {
      expect(zone.openFrame ?? null, `${id}: кадр снят`).toBeNull();
      expect(zone.openVerb ?? null, `${id}: и обещание вместе с ним`).toBeNull();
      expect(zone.accepted, `${id}`).toBe(false);
      expect(zone.reshoot, `${id}: ушли в очередь на пересъёмку`).toBe(true);
      expect(zone.reshootReason, `${id}: кольцо записано числом`).toMatch(
        /Кольцо вокруг зоны 0\.\d+ при границе 0\.09$/u,
      );
    }
    // Файлы уехали в legacy, а не удалены: имя освобождено под будущий кадр.
    const shipped = new Set(readdirSync(resolve(PKG, "refs")));
    const kept = new Set(readdirSync(resolve(PKG, "refs/legacy")));
    for (const { id, room, zone } of dropped) {
      expect(shipped.has(`o-${room.id}-${zone.key}.jpg`), `${id}: кадр обязан уехать`).toBe(false);
      expect(kept.has(`round3-o-${room.id}-${zone.key}.jpg`), `${id}: но не пропасть`).toBe(true);
    }
    // Четыре кадра раунда 3, переоценённые тикетом 53, тоже остаются в legacy.
    for (const key of ["fashion", "jewelry", "bags", "anything"]) {
      expect(kept.has(`round3-o-cream-${key}.jpg`), `cream/${key}: история цела`).toBe(true);
    }
  });

  it("раунд 8, «Кремовая»: две партии в контракте числами", () => {
    // Первая полная комната раунда 8 (тикет 53). Сводка лежит в контракте
    // (`round8`), как `identityCheck` у тикета 49: отчёт в тикете легко
    // расходится с данными, числа рядом с флагами — нет.
    const raw = JSON.parse(readFileSync(resolve(PKG, "handoff/rooms.json"), "utf8")) as {
      round8: {
        batch: string;
        shot: number;
        passedThresholdBatchBase: number;
        passedThresholdCleanBase: number;
        passedThresholdOurBase: number;
        connected: number;
        eyes: {
          reviewed: number;
          honest: number;
          substitution: number;
          contentLost: number;
          nothingHappened: number;
        };
        base: { identical: boolean; l1: number };
        note: string;
        masksArrived: boolean;
      };
    };
    const history = raw.round8 as unknown as {
      batches: number;
      latest: {
        batch: string; shot: number; passedThreshold: number; connected: number;
        eyes: { reviewed: number; honest: number; contentLost: number; outOfFocus: number };
        base: { identical: boolean; sha256: string };
        masksArrived: number; note: string;
      };
      first: typeof raw.round8;
    };
    expect(history.batches).toBe(2);

    // Партия 1 (тикет 53): 13 кадров, подключено 0, база не наша — история
    // хранится целиком, чтобы урок не потерялся.
    const first = history.first;
    expect(first.shot).toBe(13);
    expect(first.connected).toBe(0);
    expect(first.base.identical).toBe(false);
    expect(first.base.l1).toBeCloseTo(0.0327, 4);
    expect(first.masksArrived).toBe(false);

    // Партия 2: база байт-в-байт наша — блок «база» исчез из приёмки, как и
    // обещали; порог 6 из 6, глаза сняли два (пропажа и расфокус).
    const latest = history.latest;
    expect(latest.batch).toBe("cream");
    expect(latest.shot).toBe(6);
    expect(latest.passedThreshold).toBe(6);
    expect(latest.connected).toBe(4);
    expect(latest.eyes.reviewed).toBe(6);
    expect(
      latest.eyes.honest + latest.eyes.contentLost + latest.eyes.outOfFocus,
    ).toBe(6);
    expect(latest.base.identical).toBe(true);
    expect(latest.base.sha256).toBe("06a03e87ff2d6ce7");
    expect(latest.masksArrived).toBe(3);

    // Двенадцать вердиктов раунда 8 лежат у зон (travel не переоценивался:
    // его рабочий кадр раунда 3 подключён, а новый кадр партии не нужен —
    // DESIGN-BRIEF-08 §5 прямо запрещал переснимать работающие).
    const cream = contractRooms.find((room) => room.id === "cream")!;
    const reviewed = cream.zones.filter((zone) => zone.reshootReason?.includes("тикет 53"));
    expect(reviewed.map((zone) => zone.key).sort()).toEqual(
      [
        "bags", "beauty", "books", "events", "fashion",
        "jewelry", "money", "music", "perfume",
      ].sort(),
    );
    const byClass = (klass: string) =>
      reviewed.filter((zone) => zone.reshootReason?.startsWith(klass)).map((zone) => zone.key);
    expect(byClass("честное раскрытие, не подключён").sort()).toEqual(
      ["events", "jewelry", "money"].sort(),
    );
    // Подмены первой партии: bags, beauty, books (perfume перекрыт партией 2;
    // anything и flowers — «подмена окружения» — подключены честными кадрами
    // партии 2, их причины сняты вместе с reshoot).
    expect(byClass("подмена").sort()).toEqual(["bags", "beauty", "books"].sort());
    expect(byClass("действия нет").sort()).toEqual(["music"].sort());
    // Партия 2 переоценила двоих: у fashion и perfume причина начинается с
    // «партия 2» — их вердикты первой партии перекрыты вторыми кадрами
    // (fashion: пропажа двух свитеров, третий раз; perfume: зона в расфокусе).
    expect(byClass("партия 2").sort()).toEqual(["fashion", "perfume"].sort());
    for (const zone of reviewed) {
      expect(zone.openFrame ?? null, `cream/${zone.key}: кадр партии не подключён`).toBeNull();
      expect(zone.accepted, `cream/${zone.key}`).toBe(false);
      expect(zone.reshoot, `cream/${zone.key}: очередь на пересъёмку`).toBe(true);
    }
    // В раздаче — пять кремовых кадров: travel партии 2 плюс home, flowers,
    // anything (fashion и perfume партия 2 не прошла по глазам).
    const shipped = readdirSync(resolve(PKG, "refs")).filter((f) => f.startsWith("o-cream-"));
    expect(shipped.sort()).toEqual([
      "o-cream-anything.jpg",
      "o-cream-flowers.jpg",
      "o-cream-home.jpg",
      "o-cream-travel.jpg",
    ]);
  });

  it("прямоугольники cream/events, cream/money и cream/beauty применены ровно из rects-fix", () => {
    // Прямоугольники приложения, чью комнату раунд 8 уже прислал; events и
    // money дизайн подтвердил словами («восемь да», ОТВЕТ-раунд-8). Beauty —
    // пункт 12, найден при сверке замеров 06.08 (ANSWERS-cream-measures):
    // прямоугольник стоял на зеркале визажиста, предмет — органайзер ниже и
    // левее. Остальные девять ждут партий своих комнат — их применяет
    // отдельный тикет, а не этот тест.
    const fix = JSON.parse(
      readFileSync(resolve(__dirname, "../design/rects-fix.json"), "utf8"),
    ) as { zones: { room: string; key: string; rect: unknown; was: unknown }[] };
    const cream = contractRooms.find((room) => room.id === "cream")!;
    for (const key of ["events", "money", "beauty"]) {
      const fixed = fix.zones.find((z) => z.room === "cream" && z.key === key)!;
      const zone = cream.zones.find((z) => z.key === key)!;
      expect(zone.rect, `cream/${key}: прямоугольник из приложения`).toEqual(fixed.rect);
      expect(zone.rectOld, `cream/${key}: прежний сохранён для сверки`).toEqual(fixed.was);
      expect(zone.remappedRound, `cream/${key}`).toBe(8);
    }
    // Предметы разъехались — деление предмета с «Что угодно» снято.
    const money = cream.zones.find((z) => z.key === "money")!;
    expect(money.sharedObjectWith).toBeUndefined();
  });

  it("итог просмотра записан в контракт числами, а не только в отчёт", () => {
    // Отчёт живёт в тикете и легко расходится с данными — как разошлось письмо
    // дизайна («accepted стоит на каждой зоне» при 33 из 130). Сводка лежит
    // рядом с флагами, и арифметика сходится с самими зонами.
    const raw = JSON.parse(readFileSync(resolve(PKG, "handoff/rooms.json"), "utf8")) as {
      identityCheck: {
        reviewed: number;
        honest: number;
        substitution: number;
        contentLost: number;
        nothingHappened: number;
        ringMax: number;
        note: string;
        ringNote: string;
      };
    };
    const check = raw.identityCheck;
    expect(check.reviewed).toBe(30);
    // identityCheck — снимок аудита 49: семь честных ТОГДА. Партия 2 добавила
    // четыре кадра сверх аудита — их история в `round8.latest`, а не здесь.
    expect(check.honest).toBe(7);
    const latestConnected = (
      raw as unknown as { round8: { latest: { connected: number } } }
    ).round8.latest.connected;
    // Раунды 14–15 (тикет 81) добавили семь кадров сверх обеих историй —
    // они снимались от НАШИХ баз, а не от пакета, и в снимок аудита 49 не
    // входят по построению. Поэтому арифметика теперь трёхчленная.
    // Тикет 81-2 добавил восьмой — `lux/travel` из той же партии раунда 14,
    // раунд 16 девятый — `warm/anything`.
    const OUR_BASE_ROUNDS = 9;
    expect(withFrame.length).toBe(check.honest + latestConnected - 1 + OUR_BASE_ROUNDS);
    // (−1: travel был честным у аудита И заменён партией 2 — не двойной счёт.)
    expect(check.substitution + check.contentLost + check.nothingHappened + check.honest).toBe(30);
    expect(check.ringMax).toBe(0.09);
    // Кольцо — флаг для глаза, а не отказ. Это записано, чтобы следующий
    // читатель не превратил его в порог: `study/events` кольцо не проходит.
    expect(check.ringNote).toMatch(/ФЛАГ, а не как отказ/u);
    expect(check.ringNote).toMatch(/study\/events/u);
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
   * РЕЕСТР ДОЛГА. Пятнадцать пар завела переразметка раундов 4–5; раунд 8
   * закрыл одну — `cream/events×flowers` исчезла вместе с применением
   * подтверждённого прямоугольника events (тикет 53): новый правый край 566,
   * до flowers (568) зазор в 2 единицы, как и обещал rects-fix. Раунд 11
   * закрыл вторую — `cottage/music×home` (108 px²) исчезла, когда «Музыка»
   * переехала с сундука на сам проигрыватель: старая рамка краем залезала на
   * «Для дома». Осталось 13.
   * Список закрытый: новая пара уронит тест, а закрытая — исчезнет из него
   * вместе со строкой. Площадь держим, чтобы было видно, где кромка задела
   * кромку (15 px²), а где предметы наложились всерьёз (7020 px²).
   */
  const OVERLAP_DEBT = [
    "cream/books×music (15 px²)",
    "warm/home×flowers (2576 px²)",
    "warm/books×flowers (1728 px²)",
    "lux/books×flowers (924 px²)",
    "emerald/books×music (2496 px²)",
    "emerald/books×flowers (5704 px²)",
    "bold/books×flowers (3040 px²)",
    "bold/flowers×home (1380 px²)",
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

  it("НАХОДКА ЗАКРЫТА: cream/events больше не сидит в углу cream/flowers", () => {
    // До раунда 8 это была единственная пара контракта с совпадающим началом —
    // 568,148 у обеих: «Впечатлениям» досталась скопированная строка «Цветов»,
    // и две зоны показывали одну вазу. Тикет 47 нашёл настоящую стену памяти
    // (rects-fix), дизайн подтвердил («восемь да»), тикет 53 применил — теперь
    // совпадающих начал в контракте ноль, и это правило сторожится дальше:
    // следующая скопированная строка уронит тест.
    const corners = new Map<string, string[]>();
    for (const { id, zone } of allZones) {
      const key = `${zone.rect.x},${zone.rect.y}`;
      corners.set(`${id.split("/")[0]}|${key}`, [
        ...(corners.get(`${id.split("/")[0]}|${key}`) ?? []),
        id,
      ]);
    }
    const shared = [...corners.values()].filter((group) => group.length > 1);
    expect(shared).toEqual([]);
  });

  it("в рендере пар столько же: включённая зона money вернула свою пару", () => {
    // Прежде продукт не чувствовал пару `sport/sport×money`: зона `money` не
    // рисовалась вовсе, значит и нажатие у неё было не отнять. ADR-0008 зону
    // включил — пара вернулась в живые, и реестр долга совпадает с рендером
    // строка в строку.
    const shown = rooms.flatMap(overlapsIn).map((o) => `${o.id} (${o.area} px²)`);
    expect(shown).toEqual(OVERLAP_DEBT);
    expect(shown).toHaveLength(13);
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
    // Правило считалось ДО переразметки, в координатах окна 430. У
    // переразмеченных зон (34 в раунде 4, 13 в раунде 5, 3 в раунде 8, 1 в
    // раунде 11 — cream/events ушла из счёта раунда 5 в раунд 8 вместе с новым
    // прямоугольником rects-fix, cottage/music из раунда 4 в раунд 11)
    // прямоугольник с тех пор сменился, и контракт снял с них флаг обрезки:
    // они больше не прижаты ни к какому краю. Поэтому у переразмеченных
    // проверяется только это, а машинное правило — у остальных, по их
    // собственному прямоугольнику.
    const remapped = allZones.filter(({ zone }) => zone.remappedRound);
    expect(remapped.filter(({ zone }) => zone.remappedRound === 4)).toHaveLength(34);
    expect(remapped.filter(({ zone }) => zone.remappedRound === 5)).toHaveLength(13);
    expect(remapped.filter(({ zone }) => zone.remappedRound === 8).map((z) => z.id)).toEqual([
      "cream/beauty",
      "cream/events",
      "cream/money",
    ]);
    // Раунд 11 — наша находка, а не партия дизайна: прямоугольник «Музыки» в
    // «Загородном доме» стоял на сундуке ПОД проигрывателем. До раунда 4 он
    // стоял на самой вертушке (y 217) — раунд 4 сдвинул его вниз на 21
    // единицу, и это была регрессия, которую никто не заметил три раунда.
    // Тикет 63 добавил в тот же раунд две зоны с той же болезнью: `study/travel`
    // и `loft/travel` стояли на фронте НИЖНЕГО сундука (коробки), а раскрывается
    // ВЕРХНИЙ, который на нём стоит. Диагноз пришёл от дизайна, числа измерены
    // нами по оригиналам 4k — его замены съедали зону обуви и уезжали в x=0.
    expect(remapped.filter(({ zone }) => zone.remappedRound === 11).map((z) => z.id)).toEqual([
      "cottage/music",
    ]);
    // Раунд 13 (тикет 75) — тоже наша находка. `study/travel` и `loft/travel`
    // переехали сюда из раунда 11: раунд 11 поставил их на ВЕРХНИЙ сундук
    // (коробку), но поднять верх рамки под откидывающуюся крышку было некуда —
    // сверху сидел `sneakers`, размеченный не по обуви, а по деревянной панели
    // и крышке самого сундука. Раунд 13 переставил `sneakers` на четыре пары
    // и отдал освободившееся место `travel`.
    //
    // Следом пришлось подвинуть соседей, иначе рамки пересеклись бы:
    // `study/anything` стоял на полу и краем задевал подарочные коробки —
    // переставлен на них; `loft/fashion` свисал на 23 единицы ниже одежды и
    // лежал на верхе обуви — подрезан по рейлу.
    //
    // Замену дизайна (раунд 13, `changed-fields.json`) НЕ взяли: это те же
    // числа, что отклонили в раунде 11, — x=0 при окне с 12 и до 1092 px²
    // поверх соседних зон. Разбор — .scratch/acceptance-2026-08-07/issues/75.
    expect(remapped.filter(({ zone }) => zone.remappedRound === 13).map((z) => z.id)).toEqual([
      "study/anything",
      "study/sneakers",
      "study/travel",
      "loft/fashion",
      "loft/sneakers",
      "loft/travel",
    ]);
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

  it("13 прямоугольников исправлены осмотром раунда 5 — cream/events переехала дальше", () => {
    // Раунд 5 исправлял 14; `cream/events` из этого счёта ушла в раунд 8:
    // rects-fix нашёл настоящую стену памяти, дизайн подтвердил, тикет 53
    // применил — теперь у неё remappedRound: 8, а здесь остаются 13.
    const fixed = allZones.filter(({ zone }) => zone.remappedRound === 5);
    expect(fixed.map((z) => z.id)).toEqual([
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
