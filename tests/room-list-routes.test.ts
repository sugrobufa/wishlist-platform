// Отдельные экраны списка и длинное имя в общей строке — обход 10.08.2026.
//
// ДВА ДОЛГА В ОДНОМ ФАЙЛЕ, и они про один и тот же экран.
//
// A ОСИРОТЕВШИЕ МАРШРУТЫ (долг тикета 129). Тикет 129 перенёс знак «Списком»
//   из угла сцены в полосу под кадром — он переключает содержимое ТОЙ ЖЕ
//   полосы, кадр с экрана не уходит. Страницы `/room/list` и `/r/{slug}/list`
//   остались живы, а ссылок на них не осталось нигде: счётом по `src/`, `e2e/`
//   и `messages/` не нашлось ни одной. Решение — ОСТАВИТЬ и вернуть дорогу в
//   одном месте, потому что полоса показывает то же содержимое, но она окно в
//   него, а не весь он:
//   - на десктопе полоса ровно 116 px, окно списка в ней 64 px, а самого
//     списка 3809 px (замер 1440×900 на демо-комнате в 57 вещей). Высота
//     полосы входит в расчёт раскладки сцены — взять больше неоткуда;
//   - положение переключателя нарочно нигде не хранится (условие тикета 129):
//     это взгляд, а не адрес, и переслать его ссылкой нельзя;
//   - полоса клиентская: до гидратации и без JS списка в разметке нет вовсе.
//   Дорога — с ДРУГОГО экрана, из настроек: ровно той формулой дизайн
//   согласился убрать «Сокровищницу» из таб-бара (турн 36c, тикет 119). Знак
//   в углу СЦЕНЫ не возвращается — за этим следит tests/rail-list-toggle.
//
// B ДЛИННОЕ ИМЯ БЕЗ ПРОБЕЛОВ в общей строке `room-list`. Имя заводит человек,
//   поле принимает 200 знаков, и слово без единого места переноса выходит из
//   своей полосы. Замер на 375 (63 знака, ни пробела, ни дефиса — дефис
//   браузер рвёт сам): на странице `/room/list` название занимало 550 px и
//   раздвигало документ 375 → 658, страница ехала вбок пальцем; в полосе под
//   кадром документ не ехал (у `.listPane` стоит `overflow-y: auto`, а он по
//   спецификации делает `auto` и горизонталь), зато имя молча обрывалось за
//   правым краем. После правки — 375 → 375 и название в 158 px тремя строками.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const settings = read("../src/app/settings/settings-sections.tsx");
const ownerList = read("../src/app/room/list/page.tsx");
const guestList = read("../src/app/r/[slug]/list/page.tsx");
const shared = read("../src/components/room-list/room-list.module.css");
const zoneOwn = read("../src/components/zone-row/zone-row.module.css");
const dictionary = JSON.parse(read("../messages/ru.json")) as Record<
  string,
  Record<string, string>
>;

describe("A — у экрана списка снова есть дорога", () => {
  it("страницы живы: их не сняли молча", () => {
    // Снятие маршрута — удаление продукта, и делать его молча нельзя. Файлы
    // на месте — значит решение «оставить» ещё в силе.
    expect(ownerList.length).toBeGreaterThan(0);
    expect(guestList.length).toBeGreaterThan(0);
  });

  it("ссылка стоит в настройках, в секции полок", () => {
    const zones = settings.slice(settings.indexOf("export function ZonesSection"));
    const hall = zones.indexOf("export function OccasionSection");
    const inZones = hall > -1 ? zones.slice(0, hall) : zones;
    expect(inZones, "запасная лестница в «комнату списком» пропала").toContain('href="/room/list"');
  });

  it("это ссылка, а не кнопка: экран настроек человек покидает", () => {
    // В полосе под кадром «Списком» — кнопка (тикет 129, кадр не уходит).
    // Здесь наоборот: это дорога С ДРУГОГО экрана, и она обязана вести.
    const zones = settings.slice(settings.indexOf("export function ZonesSection"));
    const link = zones.slice(zones.indexOf('href="/room/list"'));
    expect(zones.slice(0, zones.indexOf('href="/room/list"'))).toMatch(/<Link\s*$/mu);
    expect(link).toContain("pressable");
  });

  it("своих слов ссылка не заводит — берёт словарь самого списка", () => {
    // Новая строка в словаре стоит килобайта в разметке КАЖДОЙ страницы
    // (правило tests/messages-tone) и требует захода к дизайну. Здесь она не
    // нужна: у экрана списка уже есть и подпись, и объяснение.
    expect(settings).toContain('useTranslations("RoomList")');
    expect(settings).toContain('{tList("toList")}');
    expect(settings).toContain('{tList("subtitle")}');
    expect(dictionary.RoomList?.toList, "RoomList.toList пропал из словаря").toBeTruthy();
    expect(dictionary.RoomList?.subtitle, "RoomList.subtitle пропал из словаря").toBeTruthy();
  });

  it("лестница одна: второй дороги на экран комнаты не завелось", () => {
    // Знак в углу сцены владелец снял дважды и оба раза снимком. Ссылка живёт
    // ровно в одном месте — в настройках; появится вторая, тест скажет.
    const roads = settings.split('href="/room/list"').length - 1;
    expect(roads, "ссылок на отдельный список в настройках стало больше одной").toBe(1);
  });

  it("обе страницы объясняют, как на них попадают", () => {
    // Маршрут без дороги живёт ровно до следующей уборки. Пусть каждая
    // страница сама говорит, чем она добывается и зачем оставлена.
    expect(ownerList).toContain("Полки в комнате");
    expect(guestList).toMatch(/прямой адрес|Прямой адрес/u);
  });
});

describe("B — длинное имя без пробелов переносится", () => {
  it("общая строка списка получила правило переноса", () => {
    expect(shared).toMatch(/\.title \{[^}]*overflow-wrap: anywhere;/u);
  });

  it("это `anywhere`, а не `break-word`", () => {
    // `break-word` не учитывается при подсчёте минимальной ширины, то есть
    // внутри flex-строки не спасает: ровно этим он и обманул бы проверку.
    expect(shared).not.toContain("overflow-wrap: break-word");
    expect(shared).not.toContain("word-break: break-all");
  });

  it("правило общее, без телефонной ветки", () => {
    // На десктопе полоса шире, но слово в 550 px перерастает и её. Ветка тут
    // означала бы, что страницу тянет вбок только на большом экране.
    const phone = [...shared.matchAll(/@media not all and \(min-width: 1024px\) \{/gu)];
    expect(phone.length, "у общей строки появилась телефонная ветка").toBe(0);
  });

  it("экран зоны держится своим способом — общее правило ему не опора", () => {
    // ПЕРЕПИСАНО (тикет 152). Прежде оба экрана спасал один и тот же
    // `overflow-wrap: anywhere`. Строку зоны собрали заново по контракту, и
    // она стала ОДНОСТРОЧНОЙ с многоточием: переносить в ней нечего, а
    // страницу вбок не пускает пара `min-width: 0` + `overflow: hidden`
    // (замер 10.08 на 320: 62 знака без пробелов, scrollWidth остался 320).
    // Снимут общее правило — экран зоны от этого по-прежнему не сломается.
    expect(zoneOwn).toMatch(/\.main \{[^}]*min-width: 0;/u);
    expect(zoneOwn).toMatch(/\.name \{[^}]*overflow: hidden;/u);
    expect(zoneOwn, "в однострочной строке `anywhere` ничего не держит").not.toContain(
      "overflow-wrap",
    );
  });

  it("миниатюра и промежуток строки не тронуты: это числа «комнаты списком»", () => {
    // 72 и 16 — её собственная форма из вердикта пакета (секции-зоны, без
    // знаков). Экран зоны на них больше не опирается вовсе, но правка
    // переноса не имеет права сдвинуть ни одно из двух.
    expect(shared).toMatch(/\.thumb \{[^}]*width: 72px;/u);
    expect(shared).toMatch(/\.row \{[^}]*gap: 16px;/u);
  });
});
