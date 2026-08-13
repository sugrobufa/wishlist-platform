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
  zoneNotOnFrame,
  zonesHiddenByProduct,
  zonesWithoutRect,
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

  it("134 адреса: по 13 в женской комнате, по 14 в мужской", () => {
    // ДЛИНА НАБОРОВ РАЗОШЛАСЬ, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА (14.08.2026, тикет 234):
    // полка «Бар и табак» заведена ТОЛЬКО в мужских комнатах, у женских её нет
    // вовсе. До этого дня наборы были одной длины во всех десяти, и число 130
    // стояло здесь с раунда 2. Теперь 130 + четыре адреса `bar` = 134 — ровно
    // то, что `zonesNote` контракта обещал вперёд карты.
    const total = contractRooms.reduce((n, room) => n + room.zones.length, 0);
    expect(total).toBe(134);
    for (const room of contractRooms) {
      expect(room.zones.length, `${room.id}: 12 зон набора + деньги (+ бар у мужчин)`).toBe(
        room.sex === "M" ? 14 : 13,
      );
    }
    // Полка `bar` живёт только у мужчин — и во всех четырёх комнатах сразу,
    // иначе «переезд без потерь» между мужскими интерьерами потеряет её вещи.
    const withBar = contractRooms
      .filter((room) => room.zones.some((zone) => zone.key === "bar"))
      .map((room) => room.id);
    expect(withBar).toEqual(["gamer", "sport", "study", "loft"]);
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

  it("bloomAR выведен из w/h по формуле пакета — ВСЕ 130, без исключений", () => {
    // tokens.json → zoneMarker.bloom.ellipseAspect.default. Форма светового
    // пятна не размечается руками — она считается из прямоугольника, поэтому
    // расхождение значит, что кто-то правил числа мимо скрипта дизайна.
    //
    // ОГОВОРКИ `if (zone.rectOld) continue` БОЛЬШЕ НЕТ (тикет 167): дельта
    // раунда 41 пересчитала 44 отставших зоны, и формула сходится у всех 130.
    // Реестр долга ниже пуст, и эта строка — единственное правило.
    const bloom = (r: { w: number; h: number }) =>
      Math.min(120, Math.max(30, Math.round((r.w / r.h) * 58)));
    for (const { id, zone } of allZones) {
      expect(zone.bloomAR, `${id}`).toBe(bloom(zone.rect));
    }
  });

  it("ФОРМУЛА bloomAR ЗАПИСАНА В САМОМ КОНТРАКТЕ, а не только в коде", () => {
    // Долг по 44 зонам держался три раунда ровно потому, что вывести пятно из
    // прямоугольника было НЕОТКУДА: формула приезжала письмом, файл её не
    // содержал, и всякий переезд прямоугольника оставлял пятно на прежнем.
    // Теперь она стоит рядом с полем — и сторожит её эта проверка: разойдись
    // числа контракта с числами формулы, падать будет здесь, а не глазами.
    const rule = roomsContract.bloomRule;
    expect(rule).toContain("clamp(30, 120, round(rect.w / rect.h * 58))");
    expect(rule, "bloomRot формулы не имеет — это должно быть сказано").toContain("bloomRot");
    // Числа зажима и множитель — из строки контракта, а не переписаны сюда:
    // изменится формула у дизайна — тест посчитает по НОВОЙ и покажет расход.
    const m = /clamp\((\d+),\s*(\d+),\s*round\(rect\.w \/ rect\.h \* (\d+)\)\)/u.exec(rule);
    expect(m, "формулу контракта не удалось разобрать").toBeTruthy();
    const [lo, hi, factor] = (m as RegExpExecArray).slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    for (const { id, zone } of allZones) {
      const byContract = Math.min(
        hi,
        Math.max(lo, Math.round((zone.rect.w / zone.rect.h) * factor)),
      );
      expect(zone.bloomAR, `${id}: против формулы САМОГО контракта`).toBe(byContract);
    }
  });

  it("ДОЛГ ДИЗАЙНУ ЗАКРЫТ: отставших bloomAR не осталось ни одного", () => {
    // ЧТО ЭТО БЫЛО. Раунды 4 и 5 переразметили 49 зон, но форму светового пятна
    // пересчитать забыли: у 46 из них `bloomAR` был ровно равен формуле от
    // `rectOld` — от ПРЕЖНЕГО прямоугольника. Не мелочь: пятно рисуется по
    // этому числу (тикет 23), и у `emerald/home` прямоугольник из высокого стал
    // широким (67×136 → 52×28), а пятно осталось вертикальным — 30 против 108.
    // Свет лежал поперёк предмета. Реестр держал долг видимым три раунда:
    // 46 → 45 (раунд 8 починил `cream/events`, потом `cream/beauty`) → 44
    // (`cottage/music` переставлена с сундука на проигрыватель).
    //
    // ЧЕМ ЗАКРЫТ. Дельта раунда 41 (`round41/rects-delta.json`, тикет 167):
    // 59 строк, из них 44 настоящие правки — ровно этот реестр — и 15 пустышек,
    // чей `was` снят с round40 и нашим числам уже не равен. Прямоугольники в
    // дельте НЕ трогались: все 59 совпали с нашими побайтно, дизайн прислал
    // только пересчитанное пятно. Кодом мы его по-прежнему не считаем — bloom
    // производная контракта, и вычислять её у себя значило бы завести вторую
    // карту; формула теперь стоит в контракте строкой (`bloomRule`).
    //
    // Проверка осталась НУЛЁМ, а не удалена: следующая переразметка, забывшая
    // пятно, обязана падать здесь — с именем зоны и обоими числами.
    const bloom = (r: { w: number; h: number }) =>
      Math.min(120, Math.max(30, Math.round((r.w / r.h) * 58)));
    const stale = allZones.filter(({ zone }) => zone.bloomAR !== bloom(zone.rect));
    expect(
      stale.map(({ id, zone }) => `${id}: ${zone.bloomAR} вместо ${bloom(zone.rect)}`),
    ).toEqual([]);
    // 49 зон раундов 4–5 плюс cream/money и cream/beauty раунда 8 (у
    // cream/events rectOld был и раньше — раунд 5, теперь хранит прямоугольник,
    // снятый раундом 8). Раунд 11 добавил ещё две — `study/travel` и
    // `loft/travel` (тикет 63): 51 стало 53. Раунд 13 (тикет 75) добавил
    // четыре — `study/sneakers`, `study/anything`, `loft/sneakers`,
    // `loft/fashion`: 53 стало 57 (у двух зон travel rectOld уже был и просто
    // обновился). В реестр долга bloomAR никто из них НЕ попал: всем шести
    // пятно пересчитано по формуле пакета вместе с прямоугольником.
    // Тикет 81 добавил три: `bold/anything`, `gamer/anything`, `loft/anything`
    // переразмечены по диагнозу дизайна раунда 14 (жест вне нашего ректа),
    // обрезанному до куска без пересечений. 57 стало 60.
    // Тикет 81-2 добавил пять: `gamer/sneakers` (стоял на пустом проёме ниши,
    // переставлен на обувь), `lux/jewelry` (стоял на голой столешнице),
    // `lux/money` (наполовину на зеркальном отражении бокса), `lux/music`
    // (objectAbsent, ужата, чтобы уступить полосу крышке кейса) и `lux/travel`
    // (поднят на раскрытый кейс). `gamer/anything` переразмечен вторично —
    // `rectOld` у него уже был. 60 стало 65.
    // Тикет 81-3 добавил шестую — `emerald/anything`: 65 стало 66.
    // Тикет 233 добавил две: `sport/grooming` и `study/sport` переразмечены
    // впервые (у пяти остальных зон пакета 50 `rectOld` уже был и просто
    // обновился). 66 стало 68. Пятно пересчитано по формуле всем семи — в
    // реестр долга выше не попал никто.
    // Тикет 234 добавил три: `warm/music`, `sport/watches` и `study/tech` —
    // зоны, которым пакет 50 НАШЁЛ предмет глазами, а мы его измерили. Все три
    // переразмечены впервые, все три вышли из `objectAbsent`. 68 стало 71.
    // Четвёртая правка того же тикета — новая полка `study/bar`: у неё
    // `rectOld` нет и быть не может, «было» у новой зоны не существует.
    expect(allZones.filter(({ zone }) => zone.rectOld)).toHaveLength(71);
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

  it("в @theme нет ПРОЗЫ — только цвета и размеры (тикет 164)", () => {
    // ЧТО СЛОМАЛОСЬ. Дизайн держит справки в тех же блоках, что и значения, а
    // генератор отсеивал их поимённо («note и onAccent пропускаем»). Раунд 40
    // добавил в блок `text` два ключа, и оба уехали в переменные:
    //   --color-text-body-retired: rgba(255,249,242,.68) — СНЯТА, читать как body;
    //   --color-text-ink-note: «#F2EDE4 в продукте не используется: … .»
    // Второе — предложение с двоеточием и точкой ВНУТРИ объявления CSS. Список
    // имён не мог сработать по построению: имена придумывает дизайн.
    //
    // Обе строки НАЧИНАЮТСЯ с настоящего цвета — поэтому и здесь, и в самом
    // генераторе совпадение по форме требуется ПОЛНОЕ.
    const css = readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    const theme = /@theme \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? "";
    expect(theme, "блок @theme пропал из сгенерированного файла").not.toBe("");

    const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^()]*\))$/iu;
    const SIZE = /^-?\d+(?:\.\d+)?(?:px|rem|em|%|ms|s|vw|vh|fr)?$/u;
    const FONT = /^(?:"[^"]+"|[\w-]+)(?:,\s*(?:"[^"]+"|[\w-]+))*$/u;
    const declarations = [...theme.matchAll(/^\s*(--[\w-]+):\s*(.+);$/gmu)].map((m) => ({
      name: m[1] as string,
      value: (m[2] as string).trim(),
    }));
    expect(declarations.length, "в @theme не осталось объявлений").toBeGreaterThan(10);
    const prose = declarations.filter(
      (d) => !COLOR.test(d.value) && !SIZE.test(d.value) && !FONT.test(d.value),
    );
    expect(prose.map((d) => `${d.name}: ${d.value}`)).toEqual([]);
    // Два конкретных беглеца раунда 40 — поимённо, чтобы падение называло их.
    expect(css, "снятая ступень .68 снова стала переменной").not.toContain(
      "--color-text-body-retired",
    );
    expect(css, "заметка про непродуктовый цвет снова стала переменной").not.toContain(
      "--color-text-ink-note",
    );

    // Слияние ступеней доехало до сборки: .68 и .72 стали одной — body = .72.
    const tokens = JSON.parse(readFileSync(resolve(PKG, "handoff/tokens.json"), "utf8")) as {
      text: Record<string, string>;
      mail: Record<string, string>;
    };
    expect(tokens.text.body).toBe("rgba(255,249,242,.72)");
    expect(theme).toContain(`--color-text-body: ${tokens.text.body};`);
    expect(tokens.text.bodyRetired, "снятая ступень обязана остаться справкой").toContain("СНЯТА");

    // Блок `mail` в @theme НЕ ИДЁТ и не должен: он сам говорит, что письмо —
    // не продукт и его лестница не спорит с интерфейсной. Письма верстаются
    // инлайновыми стилями и переменных Tailwind не видят вовсе.
    expect(tokens.mail.ink, "#F2EDE4 живёт чернилами писем — это его законное место").toBe(
      "#F2EDE4",
    );
    expect(css, "лестница писем приехала в интерфейс").not.toContain("--color-mail");
  });

  it("`.72` белого нигде не пишется ЧИСЛОМ — только токеном (тикет 174)", () => {
    // Слияние ступеней .68 и .72 в одну (`text.body`) доехало до tokens.css
    // тикетом 164, но двенадцать мест в восьми файлах продолжали писать то же
    // значение числом. Тикет 174 схлопнул их в `var(--color-text-body)`; этот
    // сторож держит заход закрытым — иначе следующая правка вернёт число
    // молча, и лестница разъедется второй раз, как уже было.
    //
    // Ищем ОБА написания (с пробелами и без) и ОБЕ формы альфы (`.72` и
    // `0.72`). Комментарии из проверки вычтены — справка законна: в шапке
    // zone-row.module.css это значение стоит ПРОЗОЙ, описанием контракта.
    // Тело комментария затирается пробелами, а переводы строк остаются, чтобы
    // номер строки в падении был настоящим.
    const WHITE72 = /rgba\(\s*255\s*,\s*249\s*,\s*242\s*,\s*0?\.72\s*\)/iu;
    const DECLARATION = /--color-text-body:\s*rgba\(\s*255\s*,\s*249\s*,\s*242\s*,\s*0?\.72\s*\)/iu;
    const SRC = resolve(__dirname, "../src");
    const cssFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) return cssFiles(full);
        return entry.name.endsWith(".css") ? [full] : [];
      });

    const files = cssFiles(SRC);
    expect(files.length, "обход src не нашёл .css — сторож прошёл бы впустую").toBeGreaterThan(10);
    const offenders = files.flatMap((path) =>
      readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, " "))
        .split("\n")
        .flatMap((line, i) =>
          WHITE72.test(line) && !DECLARATION.test(line)
            ? [`${path.slice(SRC.length + 1).replace(/\\/gu, "/")}:${i + 1}:${line.trim()}`]
            : [],
        ),
    );
    expect(offenders, "белому .72 место в токене: color: var(--color-text-body)").toEqual([]);

    // С другой стороны сторож тоже не должен проходить впустую: объявление
    // токена обязано быть на месте, иначе заменять числа было бы не на что.
    expect(readFileSync(resolve(SRC, "styles/tokens.css"), "utf8")).toMatch(DECLARATION);
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
    // Раунд 17 (задание 14) прибавил ТРИ: `gamer/anything` чистым прогоном
    // (наш замер 4.61 — кадр раунда 14 этой зоны мы отклонили ошибочно, вывод
    // делался по мелкой вырезке), `loft/anything` и `bold/anything` —
    // СБОРКАМИ «наша база + прямоугольник жеста». Сборка раскрыта дизайном и
    // подтверждена замером: у `bold` все двенадцать соседей расходятся на
    // 0.0015–0.0031, то есть вне прямоугольника это наша база байт-в-байт.
    expect(withFrame).toHaveLength(22);
    expect(accepted).toHaveLength(22);
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
        // Раунд 17 — две из трёх собраны из нашей базы и прямоугольника жеста.
        "bold/anything",
        "gamer/anything",
        "loft/anything",
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

  it("единственный кадр раунда 7: study/events перемерен против нынешнего прямоугольника", () => {
    // Раунд 7 прислал 130 кадров, порог прошли 12, и одиннадцать из них — те же
    // зоны, что уже подключены (восемь — байт в байт тот же файл). Прибыток
    // ровно один, и он единственный, у кого прямоугольник переразмечен: кадр
    // снят ПОСЛЕ переразметки раунда 5, поэтому правило «у зоны с кадром
    // переразметки быть не может» ему не указ — оно про кадры раунда 3.
    //
    // ТИКЕТ 233 ПЕРЕРАЗМЕТИЛ ЕГО ВТОРИЧНО (`remappedRound` 5 → 50): пакет 50
    // потребовал брать билеты вместе с ЗОЛОТОЙ РАМОЙ, а прежний прямоугольник
    // накрывал только верхнюю левую четверть билетов. Кадр от этого не стал
    // недействительным — он стал ИЗМЕРЕН ЗАНОВО: `check-frames.mjs --self`
    // против нового прямоугольника, числа лежат в `frameRemeasured` (ниже
    // сверяются). Это и есть выполнение правила, а не исключение из него.
    const round7 = withFrame.filter(({ zone }) => zone.frameRound === 7);
    expect(round7.map((z) => z.id)).toEqual(["study/events"]);
    for (const { id, zone } of round7) {
      expect(zone.remappedRound, `${id}: прямоугольник переразмечен пакетом 50`).toBe(50);
      expect(zone.rectOld, `${id}: прежний прямоугольник контракт держит`).toBeTruthy();
    }
    expect(roomsContract.round7).toMatchObject({ shot: 130, passedOurThreshold: 12, connected: 1 });
  });

  it("КАДР ДЕЙСТВИТЕЛЕН, ПОКА ПРЯМОУГОЛЬНИК ТОТ ЖЕ — или пока порог перемерен", () => {
    // Это правило, из которого и вычитаются отключения: кадр действителен
    // ровно до тех пор, пока прямоугольник тот же, против которого его мерили.
    // `rectOld` — прямоугольник до последней переразметки; если он есть, зона
    // переразмечена, и порог обязан быть посчитан заново.
    //
    // ДО ТИКЕТА 233 ПРАВИЛО СТОЯЛО В ЖЁСТКОЙ ФОРМЕ: у пяти кадров раунда 3
    // `rectOld` обязан отсутствовать. Форма годилась, пока ни один из пяти не
    // двигался. `study/sport` пришлось сдвинуть: её прямоугольник был размечен
    // ПО КАДРУ «ОТКРЫТО» (в `o-study-sport.jpg` гантели вынуты из стойки и
    // стоят на полу под столом — ровно там, где стоял прямоугольник), а в
    // базовом кадре там пустой пол. Это та самая ошибка, ради которой правило и
    // заводилось, только с другой стороны: мерили не там не потому, что
    // прямоугольник уехал, а потому, что он с самого начала стоял по второй
    // половине пары.
    //
    // Поэтому форма сменилась на существо: у зоны с кадром либо прямоугольник
    // не двигался, либо есть `frameRemeasured` — наш прогон `check-frames.mjs
    // --self` ПОСЛЕ переразметки, с числами. Третьего не дано.
    const byRound: Record<string, number> = {};
    for (const { zone } of withFrame)
      byRound[zone.frameRound ?? "r3"] = (byRound[zone.frameRound ?? "r3"] ?? 0) + 1;
    // 5 раунда 3 (без поля), 1 раунда 7, 4 партии 2 раунда 8,
    // 6 раунда 14 и 1 раунда 15 (тикет 81), плюс седьмой раунда 14 —
    // `lux/travel` подключён тикетом 81-2 после переразметки соседей,
    // и 1 раунда 16 — `warm/anything` (тикет 87), и 3 раунда 17 (тикет 90).
    expect(byRound).toEqual({ r3: 5, "7": 1, "8": 4, "14": 7, "15": 1, "16": 1, "17": 3 });
    // Оба числа — номера раундов пакета, поэтому сравниваются напрямую. Кадр
    // без `frameRound` снят в раунде 3. Переразметка ПОЗЖЕ съёмки (строго
    // больше) обесценивает замер, переразметка раньше — нет: кадры раундов 8,
    // 14–17 сняты уже против нынешних прямоугольников.
    const stale = withFrame.filter(
      ({ zone }) => (zone.remappedRound ?? 0) > (zone.frameRound ?? 3),
    );
    expect(stale.map((z) => z.id)).toEqual(["lux/travel", "study/events", "study/sport"]);
    for (const { id, zone } of stale) {
      expect(
        zone.frameRemeasured,
        `${id}: прямоугольник двигали, а порог против нового не мерили`,
      ).toBeTruthy();
    }
    // Перемеряли троих. Двоих — тикетом 233, третьего (`lux/travel`) тикетом
    // 81-2 ещё в раунде 15: там перемер был, а поля для него не было, и правило
    // держалось прозой в `eyeNote`. Поле завели — прозу оставили.
    const remeasured = withFrame.filter(({ zone }) => zone.frameRemeasured);
    expect(remeasured.map((z) => z.id)).toEqual(["lux/travel", "study/events", "study/sport"]);
    for (const { id, zone } of remeasured) {
      const m = zone.frameRemeasured as {
        round: number;
        own: number;
        bg: number;
        ratio: number;
        ring: number;
      };
      // Мерили ПОСЛЕ той переразметки, которая обесценила прежний замер.
      expect(m.round, `${id}`).toBe(zone.remappedRound);
      // Тот же порог, что у `check-frames.mjs`: своя ≥ 0.05, отношение ≥ 3.
      expect(m.own, `${id}: зона не изменилась`).toBeGreaterThanOrEqual(0.05);
      expect(m.ratio, `${id}: фон плывёт`).toBeGreaterThanOrEqual(3);
      // Кольцо теперь проходит и у него: RING_MAX = 0.09.
      expect(m.ring, `${id}: кольцо плывёт`).toBeLessThanOrEqual(0.09);
      // Отношение обязано сходиться со своими же own и bg. Точность до
      // десятых, а не до сотых: скрипт делит НЕокруглённые числа и округляет
      // результат, а в файле лежат уже округлённые — у `study/events` это даёт
      // 19.93 против 19.97. Разойдись число всерьёз (переписали одно, забыли
      // другое) — увидим и здесь.
      expect(m.ratio, `${id}: отношение не сходится со своими числами`).toBeCloseTo(
        m.own / m.bg,
        1,
      );
    }
    // И главное число тикета 233: у `study/events` кольцо перестало плыть —
    // 0.1295 → 0.0439. Оно плыло не от нечестного раскрытия, а от обрезанного
    // прямоугольника: жест «билеты выходят из рамки» законно выходил наружу,
    // потому что самой рамы в прямоугольнике не было. Взяли раму — жест внутри.
    const events = remeasured.find((z) => z.id === "study/events")?.zone.frameRemeasured as {
      ring: number;
      wasRing: number;
    };
    expect(events.wasRing).toBeGreaterThan(0.09);
    expect(events.ring).toBeLessThan(events.wasRing);
  });

  it("восемь placeBased-прямоугольников пакета не применены — и это записано", () => {
    // Дизайн переставил их «по месту» (поверхность под шкафом, край стола) и
    // заодно снял `objectAbsent`. Не приняли ни то, ни другое: это одно
    // решение, а не два, и предмета в интерьере от переноса прямоугольника не
    // прибавилось. Расстановка — измерение, а не вкус (CLAUDE.md); мы должны
    // дизайну десять прямоугольников, и эти восемь ждут их.
    expect(roomsContract.round7.rectsNotApplied).toMatch(/placeBased/u);
    // Восемь адресов, а не список одной двери: с тикета 235 они разложены по
    // двум спискам — кто ждал прямоугольника (`zonesHiddenByProduct`) и кто
    // живёт без места на кадре (`zonesWithoutRect`).
    //
    // СВЕРЯЕМ ТОЛЬКО ТЕХ, КОГО РАУНД 7 МОГ ЗНАТЬ. Полка `bar` заведена тикетом
    // 234 по решению владельца 14.08.2026 — на три года пакетов позже этой
    // прозы, и требовать её имени от текста раунда 7 значит требовать
    // предвидения. Ключ назван прямо, а не отфильтрован молча: появится ещё
    // одна наша зона без предмета — эта строка заставит решить, чья она.
    const OURS_AFTER_ROUND_7 = ["bar"];
    for (const { id, zone } of allZones.filter(({ zone }) => zone.objectAbsent)) {
      if (OURS_AFTER_ROUND_7.includes(zone.key)) continue;
      expect(roomsContract.round7.rectsNotApplied, id).toContain(id);
    }
    // И обратно: всё, что раунд 7 перечислил, обязано быть в контракте — либо
    // без предмета до сих пор, либо с измеренным прямоугольником и `rectOld`.
    // Тикет 234 перевёл в правую половину троих; `emerald/beauty`,
    // `sport/gaming`, `study/gaming`, `loft/gaming` и `lux/music` остались в
    // левой (предмета в интерьере нет).
    const namedByRound7 = allZones.filter(({ id }) =>
      roomsContract.round7.rectsNotApplied.includes(id),
    );
    expect(namedByRound7).toHaveLength(8);
    expect(
      namedByRound7.filter(({ zone }) => !zone.objectAbsent).map(({ id }) => id),
    ).toEqual(["warm/music", "sport/watches", "study/tech"]);
    for (const { id, zone } of namedByRound7.filter(({ zone }) => !zone.objectAbsent)) {
      expect(zone.rectOld, `${id}: вышла из «нет предмета» без прежнего прямоугольника`).toBeTruthy();
      expect(zone.remapNote, `${id}: вышла из «нет предмета» без разбора словами`).toBeTruthy();
    }
  });

  it("шапка карты — проза пакета 40, словарь зон — редакция пакета 52, обе ДОСЛОВНО", () => {
    const round40 = JSON.parse(readFileSync(resolve(PKG, "handoff/round40/rooms.json"), "utf8")) as {
      mapSnapshot: unknown;
    };
    const round52 = JSON.parse(readFileSync(resolve(PKG, "handoff/round52/rooms.json"), "utf8")) as {
      zonesNote: string;
    };
    // Дословно — значит посимвольно: прозу дизайна мы не переписываем своими
    // словами, даже когда она говорит про его поля (`rectPrevDesign`, `status`),
    // которых у нас нет.
    expect(roomsContract.mapSnapshot).toEqual(round40.mapSnapshot);
    expect(roomsContract.zonesNote).toBe(round52.zonesNote);
    // Снимок называет ту же карту, от которой посчитан `places.json`.
    expect(roomsContract.mapSnapshot.source).toContain("rooms-map-2026-08-10.json");

    // ПРОЗА ПЕРЕЕХАЛА С 40 НА 52, А ПРЯМОУГОЛЬНИКИ — НЕТ, И ЭТО ГЛАВНОЕ В
    // ЭТОЙ ПРОВЕРКЕ. Пакет 52 прислал `rooms.json` ЦЕЛИКОМ, и его копия наших
    // координат отстала на час: `study/sport` у него 300,244,68,86 (пустой пол
    // под столом), `loft/events` — 400,165,35,60 (чёрная колонна, билетов внутри
    // ноль). Оба мы переразметили тикетом 233 в тот же день. Поэтому из его
    // файла взято РОВНО ОДНО ПОЛЕ — `zonesNote`, точечно: перенос целиком стёр
    // бы семь свежих прямоугольников, `rectOld`, `remappedRound` и перемеры
    // порога. Правило старое (потеря раунда 20), цена выросла.
    expect(roomsContract.zonesNote).toContain("13 в женских комнатах, 14 в мужских");
    expect(roomsContract.zonesNote).toContain("134 адреса");
    // Три состояния полки — новая редакция инварианта №9 (письмо 56).
    expect(roomsContract.zonesNote).toContain("ЖИВАЯ полка без места на кадре");
    expect(roomsContract.zonesNote).toContain("404 только за полкой, выключенной хозяйкой");
    // И вывод письма 57: первый шаг выбирает КОМНАТЫ, а не полки.
    expect(roomsContract.zonesNote).toContain("выбирает КОМНАТЫ");

    // ОДНО ЧИСЛО ЕГО ПРОЗЫ РАЗОШЛОСЬ С КАРТОЙ, и разошлось нашей работой:
    // «Таких 7» — про полки без места на кадре. Тикет 234 сделал восьмой
    // `lux/music`: пакет 50 обещал в мраморной нише проигрыватель, а в нише
    // книги, раскрытый альбом и ящик — вертушка видна только отражением в
    // зеркале столика, и размечать отражение нельзя. Строку НЕ правим, она
    // дословная цитата; расхождение названо здесь и ушло письмом. Приедет
    // копия с восьмёркой — тест велит перечитать её прозу.
    expect(roomsContract.zonesNote).toContain("Таких 7");
    expect(zonesWithoutRect, "дизайн обещал семь полок списком, у нас восемь").toHaveLength(8);
  });

  it("зоны «по месту»: из пакета взята ПРОЗА, поведение не тронуто", () => {
    // Раунд 40 назвал словом то, что у шести зон без предмета прямоугольник
    // стоит на ПОВЕРХНОСТИ, где предмет стоял бы, и привязан к соседу
    // (`anchoredTo`). Прямоугольники при этом наши — все совпали с дампом.
    //
    // ИХ СТАЛО ТРИ (тикет 234). Половина шестёрки была «по месту» ровно потому,
    // что предмет не нашли ГЛАЗАМИ: пакет 50 пересмотрел кадры и назвал предмет
    // трём из них — `warm/music`, `sport/watches`, `study/tech`. Мы их измерили,
    // и «по месту» с них снято вместе с `objectAbsent` и `anchoredTo`: у зоны с
    // измеренным предметом этому полю взяться неоткуда. Осталась ровно та
    // половина, где предмета нет и по второму осмотру.
    const placeBased = allZones.filter(({ zone }) => zone.placeBased);
    expect(placeBased.map((z) => z.id)).toEqual([
      "lux/music",
      "emerald/beauty",
      "study/gaming",
    ]);
    // Новые полки `bar` в трёх мужских комнатах этим полем НЕ помечены, хотя
    // прямоугольник у них тоже служебный: `placeBased` — слово пакета 40 про
    // его собственную восьмёрку, и раздавать чужой флаг своим зонам значит
    // тихо менять его смысл. Наш служебный прямоугольник объяснён `absentNote`.
    for (const { id, zone } of allZones.filter(({ zone }) => zone.key === "bar")) {
      expect(zone.placeBased, `${id}: чужой флаг на нашей полке`).toBeUndefined();
      expect(zone.anchoredTo, `${id}`).toBeUndefined();
    }
    for (const { id, room, zone } of placeBased) {
      // Поле НИЧЕГО не открывает: зона по-прежнему без предмета и в кадре её
      // нет, а место пустой сцены на неё не встаёт (empty-places.ts).
      //
      // «В кадре нет» — с тикета 235 это два разных состояния: адрес, скрытый
      // продуктом (404), и живая полка без места на кадре (200, но без метки).
      // Прямоугольник «по месту» не годится ни тому, ни другому.
      expect(zone.objectAbsent, `${id}: поле «по месту» вернуло зону в продукт`).toBe(true);
      const [roomId, key] = id.split("/") as [string, string];
      expect(zoneNotOnFrame(roomId, key), `${id}: прямоугольник «по месту» попал в кадр`).toBe(true);
      expect(zone.openFrame ?? null, `${id}`).toBeNull();
      // Привязка — ключ СОСЕДНЕЙ зоны той же комнаты, а не выдуманное слово.
      expect(
        room.zones.some((neighbour) => neighbour.key === zone.anchoredTo),
        `${id}: anchoredTo="${zone.anchoredTo}" — такой зоны в комнате нет`,
      ).toBe(true);
      expect(zone.anchoredTo, `${id}: зона привязана к самой себе`).not.toBe(zone.key);
    }
  });

  it("КОПИЯ КОНТРАКТА ИЗ ПАКЕТА 40 НЕ ПРИНЯТА ЦЕЛИКОМ — и вот чем она отличается", () => {
    // Прямоугольники в ней верны все 130. Но вместе с ними она стирает нашу
    // приёмку — 216 полей осмотров, причин пересъёмки и разборов переразметки
    // (письмо 44). Поэтому взята только проза, а этот тест сторожит, чтобы
    // однажды кто-нибудь не «синхронизировал» файл целиком.
    type PkgZone = {
      key: string;
      rect: { x: number; y: number; w: number; h: number };
      bloomAR?: number;
      openFrame?: string | null;
      pool?: string;
    };
    type Pkg = { rooms: { id: string; sex: string; zones: PkgZone[] }[]; flags: unknown };
    const pkg = JSON.parse(
      readFileSync(resolve(PKG, "handoff/round40/rooms.json"), "utf8"),
    ) as Pkg;
    const pkgZone = new Map<string, PkgZone>();
    for (const room of pkg.rooms) for (const zone of room.zones) pkgZone.set(`${room.id}/${zone.key}`, zone);

    // ВХОД СХОДИЛСЯ 130 ИЗ 130 — до тикета 233. Пакет 40 повторял наш дамп, и
    // расхождений не было ни одного. Теперь их десять, и все десять наши: пакет
    // 50 прислал не координаты, а ПРАВИЛО («прямоугольник берёт предмет вместе
    // с тем, что его держит»), измеряет прямоугольники по уставу разработка, и
    // эти десять измерены нами по базовым кадрам. Список закрытый: одиннадцатое
    // расхождение обязано быть объяснено здесь же, а не появиться молча.
    //
    // ЧЕТЫРЁХ АДРЕСОВ У ПАКЕТА 40 НЕТ ВОВСЕ — это полка `bar`, заведённая
    // решением владельца 14.08.2026. Отсутствие записи и расхождение координат —
    // разные вещи, и мерить их одной проверкой значит спрятать одно за другим.
    const knownToPackage = allZones.filter(({ id }) => pkgZone.has(id));
    const newAddresses = allZones.filter(({ id }) => !pkgZone.has(id));
    expect(newAddresses.map((z) => z.id)).toEqual([
      "gamer/bar",
      "sport/bar",
      "study/bar",
      "loft/bar",
    ]);
    // У новой зоны «было» не существует, поэтому с неё спрашивается другое:
    // разбор словами (у той, чей прямоугольник измерен) либо причина, почему
    // предмета нет (у трёх остальных).
    for (const { id, zone } of newAddresses) {
      expect(zone.rectOld, `${id}: у новой полки «было» взяться неоткуда`).toBeUndefined();
      expect(
        zone.remapNote ?? zone.absentNote,
        `${id}: новая полка без разбора словами`,
      ).toBeTruthy();
    }

    const rectDiff = knownToPackage.filter(
      ({ id, zone }) => JSON.stringify(pkgZone.get(id)?.rect) !== JSON.stringify(zone.rect),
    );
    expect(rectDiff.map((z) => z.id)).toEqual([
      "warm/music",
      "gamer/sport",
      "gamer/events",
      "sport/watches",
      "sport/grooming",
      "sport/events",
      "study/events",
      "study/tech",
      "study/sport",
      "loft/events",
    ]);
    // И у каждого расхождения есть обе половины приёмки: прежний прямоугольник
    // и разбор словами. Без них расхождение неотличимо от промаха.
    for (const { id, zone } of rectDiff) {
      expect(zone.rectOld, `${id}: прежний прямоугольник не сохранён`).toBeTruthy();
      expect(zone.remapNote, `${id}: переразметка без разбора словами`).toBeTruthy();
      expect(zone.remappedRound, `${id}`).toBe(50);
    }

    // НАША ПРИЁМКА НА МЕСТЕ. В его копии эти числа обнулены.
    const count = (field: string) =>
      allZones.filter(({ zone }) => field in (zone as Record<string, unknown>)).length;
    expect({
      accepted: count("accepted"),
      reshootReason: count("reshootReason"),
      remapNote: count("remapNote"),
      eyeNote: count("eyeNote"),
      absentNote: count("absentNote"),
      reshoot: count("reshoot"),
      rectOld: count("rectOld"),
      frameRemeasured: count("frameRemeasured"),
    }).toEqual({
      accepted: 134,
      reshootReason: 50,
      // 16 + 7 разборов переразметки тикета 233 + 4 тикета 234 (три предмета,
      // найденные пакетом 50, и новая полка `study/bar`).
      remapNote: 27,
      eyeNote: 12,
      // Восемь и осталось: три зоны вышли из «нет предмета» и причину потеряли
      // вместе с флагом, три новые полки `bar` её завели, `lux/music` осталась.
      absentNote: 8,
      // 100 + четыре зоны тикета 234: у каждой теперь есть прямоугольник, но
      // кадра «открыто» нет, а третьего состояния у зоны не бывает.
      reshoot: 104,
      // 66 + `sport/grooming` и `study/sport`, переразмеченные впервые,
      // + три предмета тикета 234.
      rectOld: 71,
      // Новое поле тикета 233: две пары «Кабинета» плюс `lux/travel`, чей
      // перемер тикета 81-2 до сих пор жил только прозой.
      frameRemeasured: 3,
    });
    // Блоки, вырезанные в его копии, и `flags` объектом, а не строкой.
    expect(roomsContract.round7).toBeTruthy();
    expect(roomsContract.acceptedRule).toBeTruthy();
    expect(typeof roomsContract.flags).toBe("object");
    expect(typeof pkg.flags).toBe("string");

    // ТРИ ВЕЩИ ИЗ ПАКЕТА НЕ ВЗЯТЫ НАМЕРЕННО (все выписаны письмом 44).
    // 1. bloomAR был взят НЕ ОТСЮДА, и это единственный пункт, который с тех
    //    пор закрылся. В копии раунда 40 форма пятна отстала от прямоугольника
    //    ровно там, где дизайн его переписал, — а выводится она из w/h, и
    //    пересчитать её должен был он. Пересчитал: раунд 41 прислал ДЕЛЬТУ
    //    (`round41/rects-delta.json`, тикет 167), 44 значения приняты, формула
    //    сходится у всех 130. Расхождение с копией 40 при этом не исчезло, а
    //    выросло — она осталась там, где была, и «синхронизировать» файл
    //    целиком по-прежнему нельзя.
    const bloomDiff = allZones.filter(({ id, zone }) => pkgZone.get(id)?.bloomAR !== zone.bloomAR);
    expect(bloomDiff.length).toBeGreaterThan(0);
    // 2. Тринадцать кадров round8/cream против наших четырёх принятых: девяти
    //    файлов нет на диске нигде, а его же flags говорит «openFrame только у
    //    принятых».
    const creamFrames = (id: string) =>
      id === "ours"
        ? allZones.filter((z) => z.room.id === "cream" && z.zone.openFrame).length
        : (pkg.rooms.find((r) => r.id === "cream")?.zones.filter((z) => z.openFrame).length ?? 0);
    expect([creamFrames("ours"), creamFrames("pkg")]).toEqual([4, 13]);
    // 3. `pool: perfume` у четырёх мужских комнат спорит с его же icons.json
    //    («парфюм у женских, уход у мужских») — оставлен `grooming`.
    const perfumeInMale = (zones: { room: { sex: string }; zone: { pool: string } }[]) =>
      zones.filter((z) => z.room.sex === "M" && z.zone.pool === "perfume").length;
    expect(perfumeInMale(allZones)).toBe(0);
    expect(
      pkg.rooms
        .filter((r) => r.sex === "M")
        .flatMap((r) => r.zones)
        .filter((z) => z.pool === "perfume").length,
    ).toBe(4);
  });

  it("восемь зон без предмета: кадра нет и не будет, пока дизайн не дорисует", () => {
    // ЧИСЛО ТО ЖЕ, СОСТАВ ДРУГОЙ (тикет 234). Пакет 50 пересмотрел кадры
    // глазами и нашёл предмет трём из прежних восьми: `warm/music`,
    // `sport/watches`, `study/tech` — мы их измерили, и флаг с них снят.
    // Ровно столько же пришло с другой стороны: новая полка `bar` заведена в
    // четырёх мужских комнатах, и бара нет в трёх из них.
    // `lux/music` осталась: обещанного пакетом проигрывателя в нише нет, а
    // единственная вертушка кадра видна отражением в зеркале.
    expect(absent.map((z) => z.id)).toEqual([
      "lux/music",
      "emerald/beauty",
      "gamer/bar",
      "sport/gaming",
      "sport/bar",
      "study/gaming",
      "loft/gaming",
      "loft/bar",
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
    // objectAbsent скрыл бы зону вместе с вещами. РЕШЕНИЕ ВЛАДЕЛЬЦА 08.08.2026 —
    // «украшения скрывать не надо», зона остаётся видимой. Если кто-то однажды
    // «починит» её в objectAbsent, восемь превратятся в девять и тест упадёт
    // здесь — это и есть сторож решения.
    // Раунд 16 вернул девятую — `warm/anything`: 104 → 103, 18 → 19.
    // Раунд 17 вернул ещё три: 103 → 100, 19 → 22.
    // Тикет 234 прибавил четыре зоны сразу в «переснять»: 100 → 104. Три из
    // них вышли из «нет предмета» с измеренным прямоугольником, четвёртая —
    // новая полка `study/bar`. Кадра «открыто» нет ни у одной, значит место им
    // ровно одно. Сумма выросла со 130 до 134 вместе с картой.
    expect([accepted.length, reshoot.length, absent.length]).toEqual([22, 104, 8]);
    const doubled = allZones.filter(
      ({ zone }) => [zone.accepted, zone.reshoot, zone.objectAbsent].filter(Boolean).length > 1,
    );
    expect(doubled).toEqual([]);
    const stateless = allZones.filter(
      ({ zone }) => !zone.accepted && !zone.reshoot && !zone.objectAbsent,
    );
    expect(stateless).toEqual([]);
    expect(accepted.length + reshoot.length + absent.length).toBe(134);
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
    // второй кадр комнаты warm: 18 → 19; раунд 17 — три коробки: 19 → 22.
    expect(withFrame).toHaveLength(22);
    const connected = rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.openFrame).map((zone) => `${room.id}/${zone.key}`),
    );
    expect(connected).toHaveLength(22);
    expect(connected.filter((id) => id.startsWith("warm/") || id.startsWith("loft/")).sort()).toEqual(
      ["loft/anything", "loft/travel", "warm/anything", "warm/travel"],
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
    // раунд 16 девятый — `warm/anything`, раунд 17 добавил три коробки.
    const OUR_BASE_ROUNDS = 12;
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

  it("восемь зон без предмета разложены по ДВУМ спискам (тикеты 235 и 234)", () => {
    // РАСЩЕПЛЕНИЕ. До 14.08.2026 все восемь адресов без предмета лежали в одном
    // `zonesHiddenByProduct` и отвечали 404. Решение владельца развело их на
    // два разных смысла:
    //   - «ждёт прямоугольника» — зоны нет вовсе, 404 (предмет ей нашёл пакет
    //     50, координаты мерил тикет 234);
    //   - «живая полка без места на кадре» — 200, вещи на месте, нет только
    //     метки и наезда.
    // ЛЕВАЯ ПОЛОВИНА ОПУСТЕЛА В ТОТ ЖЕ ДЕНЬ. Тикет 234 измерил три предмета из
    // четырёх; четвёртому (`lux/music`) предмета в кадре не нашлось вовсе, и
    // адрес ушёл не в 404, а в живые полки. Ответов 404 по продуктовому решению
    // в карте больше нет ни одного — 404 осталась за `Room.zonesOff`.
    // Список в коде не живёт своей жизнью: вместе они обязаны покрывать ровно
    // те зоны, что помечены `objectAbsent` в контракте.
    expect(zonesHiddenByProduct).toEqual([]);
    expect(zonesWithoutRect).toEqual([
      "emerald/beauty",
      "lux/music",
      "sport/gaming",
      "study/gaming",
      "loft/gaming",
      // Три адреса `bar` стояли здесь вперёд самой зоны — и дождались её:
      // тикет 234 завёл полку, а в кадр она не вышла ни на день.
      "gamer/bar",
      "sport/bar",
      "loft/bar",
    ]);
    // Один адрес не может быть в обоих списках сразу: 404 и 200 одновременно
    // не бывает.
    expect(zonesWithoutRect.filter((address) => zonesHiddenByProduct.includes(address))).toEqual([]);

    const contractIds = new Set(allZones.map(({ id }) => id));
    const absent = allZones.filter(({ zone }) => zone.objectAbsent).map((z) => z.id);
    const both = [...zonesHiddenByProduct, ...zonesWithoutRect];
    // 1. Ни одна зона без предмета не выпала из обоих списков — иначе продукт
    //    поставил бы метку на пустое место.
    for (const id of absent) {
      expect(both, `${id}: помечена objectAbsent, но её нет ни в одном списке`).toContain(id);
    }
    // 2. И наоборот: всё, что мы прячем или выводим из кадра, помечено в
    //    контракте. Адреса, которых в контракте ещё нет, названы поимённо —
    //    появится зона, тест скажет, что её надо проверить глазами.
    for (const id of both.filter((address) => contractIds.has(address))) {
      const [roomId, key] = id.split("/") as [string, string];
      const zone = allZones.find((candidate) => candidate.id === id)?.zone;
      expect(zone?.objectAbsent, `${id}: выведена из кадра, а предмет у неё есть`).toBe(true);
      expect(zoneNotOnFrame(roomId, key), id).toBe(true);
    }
    // Адресов, которых в контракте ещё нет, не осталось: полка `bar` заведена.
    expect(both.filter((address) => !contractIds.has(address))).toEqual([]);

    // СКОЛЬКО ЗОН ПОКАЗЫВАЕТ ПРОДУКТ — считается по спискам, а не константой:
    // тикет 234 снимал адреса по одному, и вбитое число врало бы на другой
    // день. 134 − скрытые адресно, а скрытых адресно больше нет.
    const shown = rooms.reduce((n, room) => n + room.zones.length, 0);
    expect(allZones).toHaveLength(134);
    expect(shown).toBe(134 - zonesHiddenByProduct.length);
    expect(shown).toBe(134);
    // Полка без места на кадре в этом числе ЕСТЬ (в том и смысл), а меток в
    // кадре на столько же меньше.
    const onFrame = rooms.reduce(
      (n, room) => n + room.zones.filter((zone) => !zone.withoutRect).length,
      0,
    );
    expect(shown - onFrame).toBe(zonesWithoutRect.filter((id) => contractIds.has(id)).length);

    const perRoom = Object.fromEntries(rooms.map((room) => [room.id, room.zones.length]));
    expect(perRoom).toEqual({
      cream: 13,
      // «Музыка» вернулась во все комнаты: у `warm` с измеренным предметом,
      // у `lux` полкой без места на кадре. Ни одна не вычитается из состава.
      warm: 13,
      lux: 13,
      // «Красота» вернулась в изумрудную комнату: полка без места на кадре.
      emerald: 13,
      bold: 13,
      cottage: 13,
      // У мужских комнат состав стал 14 — прибавилась полка «Бар и табак».
      gamer: 14,
      sport: 14,
      study: 14,
      loft: 14,
    });
    // ДВЕРЬ 404 ПУСТА, И ЭТО ПРОВЕРЯЕТСЯ ОБЕИМИ СТОРОНАМИ. Пустой цикл ничего
    // не доказывает, поэтому пустота названа прямо: из продукта не вычтено ни
    // одного адреса, и число полок в комнате равно числу в контракте.
    expect(zonesHiddenByProduct).toHaveLength(0);
    for (const room of rooms) {
      const inContract = contractRooms.find((candidate) => candidate.id === room.id);
      expect(room.zones.length, `${room.id}: продукт показывает не весь состав`).toBe(
        inContract?.zones.length,
      );
    }
    // Полка без места на кадре из пресета НЕ выброшена — и помечена флагом,
    // по которому её отсеивает сцена.
    for (const address of zonesWithoutRect.filter((id) => contractIds.has(id))) {
      const [roomId, key] = address.split("/");
      const zone = rooms.find((room) => room.id === roomId)?.zones.find((z) => z.key === key);
      expect(zone, `${address}: живая полка пропала из пресета`).toBeDefined();
      expect(zone?.withoutRect, address).toBe(true);
      // Кадра раскрытия у неё нет и быть не может — раскрывать нечего.
      expect(zone?.openFrame ?? null, address).toBeNull();
    }
  });

  it("переезд без потерь: у комнат с одинаковым набором ключей он одинаков и в продукте", () => {
    // ТО, РАДИ ЧЕГО ВЛАДЕЛЕЦ ВСЁ И ПРОСИЛ (приёмка 14.08.2026, замечание 7):
    // «должен быть принцип как у женщин, лёгкий переезд во все комнаты без
    // потерь». Вещи теряют полку так: `rooms.changeRoomPreset` переводит в
    // «Что угодно» всё, чей ключ зоны не встретился в НОВОМ пресете, — а пресет
    // это `rooms`, уже без скрытых адресов. Значит достаточно, чтобы у комнат с
    // одинаковым набором ключей в контракте набор в продукте тоже совпадал.
    //
    // Здесь это проверяется на справочнике; на живой базе, через сам сервис, —
    // `tests/settings.test.ts` («переезд без потерь»).
    const keysOf = (zones: readonly { key: string }[]) => [...zones.map((z) => z.key)].sort();
    const contractSet = new Map(contractRooms.map((room) => [room.id, keysOf(room.zones)]));
    const productSet = new Map(rooms.map((room) => [room.id, keysOf(room.zones)]));

    /** Ключи, скрытые в этой комнате дверью «ждёт прямоугольника» (тикет 234). */
    const waitingIn = (roomId: string) =>
      zonesHiddenByProduct
        .filter((address) => address.startsWith(`${roomId}/`))
        .map((address) => address.split("/")[1]!);

    let pairs = 0;
    const lostEverywhere = new Set<string>();
    for (const from of contractRooms) {
      for (const to of contractRooms) {
        if (from.id === to.id) continue;
        if (contractSet.get(from.id)!.join() !== contractSet.get(to.id)!.join()) continue;
        pairs += 1;
        const lost = productSet.get(from.id)!.filter((key) => !productSet.get(to.id)!.includes(key));
        for (const key of lost) lostEverywhere.add(key);
        // ПОТЕРЯТЬ ПОЛКУ МОЖНО ТОЛЬКО ЧЕРЕЗ ДВЕРЬ, И ТОЛЬКО ПОКА ОНА ОТКРЫТА.
        // Полка без места на кадре в потери не попадает никогда — в новом
        // интерьере она есть, и вещи остаются на ней. Опустеет дверь (тикет 234
        // домерит прямоугольники) — правая часть станет пустой сама, и тест
        // превратится в «не теряется ничего» без единой правки.
        expect(
          [...lost].sort(),
          `${from.id} → ${to.id}: полки уедут в «Что угодно»`,
        ).toEqual(waitingIn(to.id).filter((key) => !waitingIn(from.id).includes(key)).sort());
      }
    }
    // Пары есть: иначе проверка была бы пустой и зелёной ни от чего. Женских
    // комнат шесть (30 упорядоченных пар), мужских четыре (12).
    expect(pairs).toBe(30 + 12);
    // И то же самое одним взглядом: сегодня переезд теряет ровно три полки, все
    // три ждут прямоугольника. «Красота» и «Игры», которые терялись до тикета
    // 235, не теряются больше нигде.
    expect([...lostEverywhere].sort()).toEqual(
      [...new Set(zonesHiddenByProduct.map((address) => address.split("/")[1]!))].sort(),
    );
    for (const address of zonesWithoutRect) {
      const key = address.split("/")[1]!;
      expect(lostEverywhere.has(key), `${address}: полка без места на кадре потеряла вещи`).toBe(
        false,
      );
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
   *
   * ТИКЕТ 233 ДОБАВИЛ ДВЕ — и обе осмотрены глазами по вырезке, а не приняты
   * числом. Правило пакета 50 велит брать предмет вместе с рамой, и рамка с
   * билетами в «Спорте» и веер билетов в «Лофте» оказались крупнее прежних
   * прямоугольников:
   *   • `sport/watches×events` 600 px² — ЗАКРЫТА ТИКЕТОМ 234. Пара держалась на
   *     служебном прямоугольнике: витрину с часами дизайн тогда «не нашёл», и
   *     `watches` стояла посреди кадра. Пакет 50 нашёл её глазами на правой
   *     полке, мы измерили — прямоугольник уехал к правому краю, пара исчезла.
   *   • `loft/music×events` 364 px² — нижний левый угол рамки билетов лёг на
   *     пустую белую стену правее микшера. Предметы не наложились: микшер стоит
   *     на столе левее 340, билеты висят выше 172.
   *
   * ТИКЕТ 234 ДОБАВИЛ ОДНУ, И ОНА ХУЖЕ ОСТАЛЬНЫХ — `study/tech×travel`
   * 756 px². Это не «кромка задела кромку»: плёночная камера, которую пакет 50
   * назвал предметом зоны `tech`, СТОИТ НА кожаном сундуке, и сундук — предмет
   * зоны `travel`. Прямоугольники вложены по построению, и правило пакета 50
   * («предмет вместе с тем, что его держит») другого исхода не допускает: без
   * куска крышки под камерой она читалась бы артефактом.
   *
   * ЦЕНА НАЗВАНА ЧИСЛОМ И СЛОВОМ. `travel` стоит в списке зоны ПОЗЖЕ `tech`,
   * значит в перекрытии выигрывает он: нажатие по камере откроет
   * «Путешествия». Метка камеры при этом горит на своём месте, и вход в полку
   * есть через указатель зон. Развести обязан дизайн — либо `travel` подрезают
   * сверху, либо камера остаётся без метки; вопрос ушёл письмом.
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
    "study/tech×travel (756 px²)",
    "loft/music×events (364 px²)",
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

  it("РЕЕСТР И ЭКРАН СНОВА СОВПАДАЮТ СТРОКА В СТРОКУ", () => {
    // Прежде продукт не чувствовал пару `sport/sport×money`: зона `money` не
    // рисовалась вовсе, значит и нажатие у неё было не отнять. ADR-0008 зону
    // включил — пара вернулась в живые, и реестр долга совпал с рендером.
    //
    // Тикет 233 эту точность сломал: `sport/watches×events` существовала только
    // в контракте, потому что `watches` была objectAbsent и на экран не
    // выходила. Тикет 234 её вернул — витрина с часами нашлась, прямоугольник
    // уехал на неё, и самой пары не стало. Ни одной пары «только в контракте»
    // не осталось: каждая строка реестра — это настоящее перекрытие двух
    // НАЖИМАЕМЫХ областей, и цена у него та же, что была в 142-м.
    const shown = rooms.flatMap(overlapsIn).map((o) => `${o.id} (${o.area} px²)`);
    expect(shown).toEqual(OVERLAP_DEBT);
    expect(shown).toHaveLength(15);
    // И ни один участник пары не спрятан: разница между контрактом и рендером
    // считается, а не помнится, — вернись она, здесь и упадёт.
    for (const pair of OVERLAP_DEBT) {
      const [roomId, keys] = pair.split("/") as [string, string];
      for (const key of (keys.split(" ")[0] as string).split("×")) {
        expect(zoneNotOnFrame(roomId, key), `${roomId}/${key}: пара с зоной вне кадра`).toBe(false);
      }
    }
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
    // 34 и 13 держались до тикета 233: пакет 50 переразметил семь зон, и две из
    // них ушли из счёта раунда 4 (`gamer/sport`, `gamer/events`), три — из
    // счёта раунда 5 (`sport/events`, `study/events`, `loft/events`).
    // Переразметка перезаписывает `remappedRound` своим номером, а не копит
    // историю: `rectOld` всегда прямоугольник ДО ПОСЛЕДНЕЙ правки, и два числа
    // обязаны говорить об одной и той же.
    expect(remapped.filter(({ zone }) => zone.remappedRound === 4)).toHaveLength(32);
    expect(remapped.filter(({ zone }) => zone.remappedRound === 5)).toHaveLength(10);
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
    // Раунд 50 (тикет 233) — общее правило дизайна, а не партия прямоугольников:
    // «прямоугольник берёт предмет ВМЕСТЕ С ТЕМ, ЧТО ЕГО ДЕРЖИТ — раму, полку,
    // столешницу; предмет без опоры читается артефактом». Четыре `events` —
    // рамка с билетами, обрезанная по стопке корешков во всех четырёх мужских
    // комнатах одинаково. Три остальные — зоны, чьи пустые места владелец
    // увидел висящими в воздухе 14.08.2026 (тикет 230): `gamer/sport` стояла на
    // голой стене над скамьёй, `sport/grooming` — на стене слева от зеркала,
    // `study/sport` — на полу под столом, потому что была размечена ПО КАДРУ
    // «ОТКРЫТО», где гантели вынуты из стойки.
    // Тикет 234 дописал в тот же раунд ТРИ — и это другая половина правила
    // пакета 50. Тикет 233 применял его к прямоугольникам, обрезанным по
    // предмету; здесь дизайн пересмотрел кадры глазами и НАШЁЛ ПРЕДМЕТ там, где
    // мы три раунда считали, что его нет: проигрыватель на мраморной консоли
    // (`warm/music`), стеклянная шкатулка с часами на правой полке
    // (`sport/watches`), плёночная камера на кожаном сундуке (`study/tech`).
    // Все три вышли из `objectAbsent`, у всех трёх прямоугольник взят вместе с
    // опорой — консолью, полкой, крышкой сундука.
    expect(remapped.filter(({ zone }) => zone.remappedRound === 50).map((z) => z.id)).toEqual([
      "warm/music",
      "gamer/sport",
      "gamer/events",
      "sport/watches",
      "sport/grooming",
      "sport/events",
      "study/events",
      "study/tech",
      "study/sport",
      "loft/events",
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

  it("eyeChecked теперь у всех 134 — непроверенных зон не осталось", () => {
    // Главный итог раунда 5. До него смотрели на 38 зон, и из оставшихся 92
    // четырнадцать показывали не тот предмет, а пять — вообще ничего: пересъёмка
    // девятнадцати кадров ушла бы впустую. Машинный `notClamped` этого не ловил
    // и поймать не мог — он про обрезку окна, а не про предмет.
    // Четыре новых адреса тикета 234 (полка `bar`) флаг получили сразу: три
    // комнаты осмотрены на предмет бара глазами и бара в них нет, четвёртая
    // (`study`) измерена по барной тележке.
    expect(allZones.filter(({ zone }) => zone.eyeChecked)).toHaveLength(134);
    expect(allZones.filter(({ zone }) => !zone.eyeChecked)).toEqual([]);
  });

  it("10 прямоугольников осмотра раунда 5 — трое events переехали дальше", () => {
    // Раунд 5 исправлял 14; `cream/events` из этого счёта ушла в раунд 8:
    // rects-fix нашёл настоящую стену памяти, дизайн подтвердил, тикет 53
    // применил — теперь у неё remappedRound: 8, оставалось 13.
    // Тикет 233 забрал ещё троих — `sport/events`, `study/events`,
    // `loft/events`: раунд 5 поставил их на билеты, а пакет 50 потребовал брать
    // билеты ВМЕСТЕ С РАМОЙ. Осталось 10.
    const fixed = allZones.filter(({ zone }) => zone.remappedRound === 5);
    expect(fixed.map((z) => z.id)).toEqual([
      "cream/books",
      "gamer/watches",
      "gamer/books",
      "gamer/money",
      "sport/sport",
      "sport/money",
      "study/watches",
      "study/money",
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

  it("wrongTarget — одна зона, и она без предмета в интерьере", () => {
    // Флаг остался с раунда 4 и на новые `objectAbsent` не распространён: там
    // дизайн не «увидел не тот предмет», а не нашёл предмета вовсе.
    //
    // ДВОИХ ИЗ ТРЁХ СНЯЛ ТИКЕТ 234, и снял правильным способом — не стиранием
    // флага, а исчезновением причины: у `warm/music` и `sport/watches` предмет
    // нашёлся и прямоугольник измерен ПО НЕМУ, значит «предмет не тот» больше
    // не про них. Флаг без своего прямоугольника — это и есть тот `verified`,
    // который врал названием.
    const wrong = allZones.filter(({ zone }) => zone.wrongTarget);
    expect(wrong.map((z) => z.id)).toEqual(["lux/music"]);
    for (const { id, zone } of wrong) {
      expect(zone.objectAbsent, `${id}`).toBe(true);
    }
    // И у снятых флаг именно СНЯТ, а не переставлен в `false`: поле пропало
    // вместе с причиной.
    for (const id of ["warm/music", "sport/watches"]) {
      const zone = allZones.find((candidate) => candidate.id === id)?.zone;
      expect(zone?.wrongTarget, `${id}: флаг пережил свою причину`).toBeUndefined();
      expect(zone?.rectOld, `${id}`).toBeTruthy();
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
    // Правее прежней стены 430 стоит 50 зон — те самые, ради которых система
    // координат и менялась (32 после раунда 4, ещё 14 после осмотра раунда 5).
    // Сорок седьмой стала `gamer/sport`: тикет 233 переставил её с голой стены
    // на скамью с гантелью, и правый край дошёл до 466.
    // Тикет 234 добавил трёх, и все три — та же болезнь правой трети: предмет
    // стоял справа, а прямоугольник ему ставили в середину кадра.
    // `sport/watches` дошла до самого края 630, `warm/music` до 538,
    // `study/bar` до 483. Достижимость — tests/immersive-layout.test.ts.
    const beyondOldEdge = allZones.filter(({ zone }) => zone.rect.x + zone.rect.w > 430);
    expect(beyondOldEdge).toHaveLength(50);
  });
});
