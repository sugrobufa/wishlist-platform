import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mailMessages } from "../src/server/mail-messages";

// Тон интерфейса (тикет 25) и писем (тикет 32). Памятка —
// design/package/handoff/tone.md, словарь-источник —
// design/package/handoff/messages-ru.json.
//
// Зачем тест: тон держится не редактурой, а границей. Одна новая строка с
// «Вы вошли как» или с восклицательным знаком возвращает продукт к тому, за
// что владелец и написал «айтишниковские тексты». Тест ловит это на месте.
//
// Письма проверяются теми же правилами, что и экраны (тикет 32): человек
// читает письмо и приходит в продукт — на границе между ними тон разъезжался
// незаметно, потому что тексты писем лежали в коде и тест их не видел.
//
// ВАЖНО: списки запрещённых слов живут здесь, а не в словаре. messages/ru.json
// next-intl сериализует в разметку КАЖДОЙ страницы (тикет 29) — служебному
// тексту там не место. По той же причине словарь писем серверный
// (src/server/mail-messages.ts) и сюда приезжает импортом, а не с диска.

type Raw = Record<string, unknown>;

function readJson(relativePath: string): Raw {
  return JSON.parse(readFileSync(resolve(__dirname, relativePath), "utf8")) as Raw;
}

/**
 * Плоская карта «Секция.ключ» → строка.
 * Пропускаются верхнеуровневые строки (у пакета это `_tone`) и ключи с
 * подчёркиванием внутри секций (раунд 4 положил `Scene._removed` — записку о
 * том, какую строку и почему он убрал). И то и другое — пометки дизайна себе,
 * а не тексты интерфейса.
 */
function flatten(raw: Raw): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [section, entries] of Object.entries(raw)) {
    if (typeof entries !== "object" || entries === null) continue;
    for (const [key, value] of Object.entries(entries as Raw)) {
      if (key.startsWith("_")) continue;
      expect(typeof value, `${section}.${key} — значение словаря обязано быть строкой`).toBe(
        "string",
      );
      flat.set(`${section}.${key}`, value as string);
    }
  }
  return flat;
}

const ruRaw = readJson("../messages/ru.json");
const enRaw = readJson("../messages/en.json");
const packageRaw = readJson("../design/package/handoff/messages-ru.json");

const ru = flatten(ruRaw);
const en = flatten(enRaw);
const handoff = flatten(packageRaw);
const mail = flatten(mailMessages);

/**
 * Граница слова по-русски: `\b` в JS смотрит на латиницу и кириллицу не видит.
 * Без этого «вы» ловилось бы внутри «выбери», а «кадр» — внутри «кадра».
 */
const LETTER = "[А-Яа-яЁёA-Za-z]";
const asWord = (body: string) => new RegExp(`(?<!${LETTER})(?:${body})(?!${LETTER})`, "iu");

/**
 * Правила памятки, которые машина умеет проверить.
 *
 * Чего в списке НЕТ и почему:
 * - «товар» — в памятке он в столбце «не говорим», но пакет сам пишет
 *   «Не похоже на страницу товара» про страницу магазина. Пакет — источник
 *   правды, значит слово живое;
 * - «пространство» — тоже из столбца «не говорим», но турн 13a принятой
 *   доски сам пишет «Тихое пространство» (знак продукта над входом) и
 *   «Обставь пространство тем, что любишь» (манифест). Тот же прецедент,
 *   что у «товара»: доска — источник правды, слово живое (тикет 56);
 * - «повод», «статус», «тип», «флаг» — пакет говорит «дождутся следующего
 *   повода», а остальные слишком общие: тест ловил бы обычную речь.
 */
const TONE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  // «Ни одного во всём продукте. Радость передаётся смыслом, а не пунктуацией.»
  ["восклицательный знак", /!/u],
  // «Подарил(а) {name}» → «Подарок от {name}». Скобка выдаёт базу данных.
  ["родовая скобка", /\([А-Яа-яЁё/]{1,4}\)/u],
  // «Слово „ошибка“ в текстах не встречается ни разу.»
  ["слово «ошибка»", asWord("ошибк[а-я]*")],
  // Везде «ты»: комната — своё пространство, а не учреждение.
  ["обращение на «вы»", asWord("вы|вас|вам|вами|ваш[а-я]*")],
  // Слова технического контракта в интерфейсе не существуют.
  ["слово из технического контракта", asWord("наезд[а-я]*|кадр[а-я]*|хотспот[а-я]*|пресет[а-я]*")],
  // «Набор зон» — тоже слово контракта. Ловим само слово, а не только пару:
  // «От набора зависят зоны комнаты» — та же мысль теми же словами. В словаре
  // на его месте живёт «заготовка».
  ["«набор зон»", asWord("набор[а-я]*")],
  // Столбец «не говорим» из памятки — то, что нельзя спутать с живой речью.
  [
    "слово не из словаря продукта",
    asWord(
      "вишлист[а-я]*|айтем[а-я]*|забук[а-я]*|зарезервир[а-я]*|окказ[а-я]*|ивент[а-я]*|" +
        "профил[ья][а-я]*|категори[а-я]*|секци[а-я]*|позици[а-я]*|" +
        "коллекци[а-я]*|архив[а-я]*|упс",
    ),
  ],
];

/** Кнопка, подпись, заголовок — без точки. Длиннее — уже фраза, ей точка можно. */
const SHORT_LINE = 40;

function violations(check: (value: string) => boolean, dictionary: Map<string, string>): string[] {
  return [...dictionary]
    .filter(([, value]) => check(value))
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`);
}

describe("тон русского словаря", () => {
  for (const [name, pattern] of TONE_RULES) {
    it(`${name} — ни разу`, () => {
      expect(violations((value) => pattern.test(value), ru)).toEqual([]);
    });
  }

  it("короткая строка не заканчивается точкой", () => {
    const dotted = violations(
      (value) => value.length <= SHORT_LINE && value.trimEnd().endsWith("."),
      ru,
    );
    expect(dotted).toEqual([]);
  });

  it("пустых значений нет", () => {
    expect(violations((value) => value.trim() === "", ru)).toEqual([]);
  });

  it("восклицательных знаков нет и в английском каркасе", () => {
    // Памятка: «ни одного во всём продукте». Английский переведут позже, но
    // тон переносится, а не изобретается заново.
    expect(violations((value) => value.includes("!"), en)).toEqual([]);
  });
});

describe("тон писем", () => {
  // Те же правила, что и у экранов: письмо — это продукт, просто пришедший
  // в почту. До тикета 32 письма говорили «Вы заняли подарок» и
  // «Здравствуйте, {имя}!» — ровно то, что памятка запрещает.
  for (const [name, pattern] of TONE_RULES) {
    it(`${name} — ни разу`, () => {
      expect(violations((value) => pattern.test(value), mail)).toEqual([]);
    });
  }

  it("короткая строка не заканчивается точкой", () => {
    const dotted = violations(
      (value) => value.length <= SHORT_LINE && value.trimEnd().endsWith("."),
      mail,
    );
    expect(dotted).toEqual([]);
  });

  it("пустых значений нет", () => {
    expect(violations((value) => value.trim() === "", mail)).toEqual([]);
  });
});

describe("письма и словарь продукта", () => {
  /**
   * Экраны и действия письмо зовёт теми же словами, что и продукт: человек
   * читает письмо, приходит по ссылке и обязан увидеть ту же надпись.
   * Слева — ключ `messages/ru.json`, справа — ключ словаря писем, который
   * обязан это слово содержать.
   */
  const SHARED_WORDS: ReadonlyArray<readonly [string, string]> = [
    ["MyBookings.title", "ReminderMail.bookings"], // «Мои подарки»
    ["MyBookings.cancel", "ReminderMail.bookingsHint"], // «Освободить вещь»
    ["Occasion.title", "OccasionMail.link"], // «Что подарили»
  ];

  for (const [productKey, mailKey] of SHARED_WORDS) {
    it(`${mailKey} говорит словами ${productKey}`, () => {
      const word = ru.get(productKey);
      const line = mail.get(mailKey);
      expect(word, `${productKey} — нет такого ключа в словаре продукта`).toBeDefined();
      expect(line, `${mailKey} — нет такого ключа в словаре писем`).toBeDefined();
      expect(String(line).toLowerCase()).toContain(String(word).toLowerCase());
    });
  }

  /**
   * Слова, от которых продукт ушёл в тикете 25, а письма — только сейчас.
   * Ловим фразой, а не словом: «бронь» сама по себе жива (памятка: «занять,
   * тихая бронь» — говорим), мертвы именно эти два оборота.
   */
  const RETIRED: ReadonlyArray<readonly [string, RegExp]> = [
    ["«мои брони» — экран зовётся «Мои подарки»", /мои\s+брон/iu],
    ["«снять бронь» — действие зовётся «Освободить вещь»", /снять\s+брон/iu],
  ];

  for (const [name, pattern] of RETIRED) {
    it(`${name} — ни разу`, () => {
      expect(violations((value) => pattern.test(value), mail)).toEqual([]);
    });
  }

  it("словарь писем клиенту не уезжает", () => {
    // Смысл серверного словаря: next-intl сериализует messages/ru.json в
    // разметку каждой страницы (тикет 29), а письма в браузере не рисуются
    // ни разу. Секция писем в продуктовом словаре = килобайт мёртвого текста
    // у каждого гостя.
    for (const section of Object.keys(mailMessages)) {
      expect(ruRaw, `секция ${section} обязана жить только на сервере`).not.toHaveProperty(section);
      expect(enRaw, `секция ${section} обязана жить только на сервере`).not.toHaveProperty(section);
    }
  });
});

/**
 * ПЕРЕИМЕНОВАНИЕ ДВУХ РАЗДЕЛОВ — решение владельца от 06.08.2026 (тикет 62):
 * «Связи» → «Друзья», «Зал славы» → «Сокровищница». Слева — слово доски,
 * справа — слово продукта, с падежами, потому что оба живут внутри фраз.
 * Список работает как замок: продукт обязан отличаться от пакета РОВНО на эти
 * замены и ни на букву больше (проверка «расхождение — только переименование»).
 */
const RENAME_62: ReadonlyArray<readonly [string, string]> = [
  // Порядок значим: сначала длинные вхождения с предлогом, потом одиночное.
  ["В зал славы", "В сокровищницу"],
  ["в зал славы", "в сокровищницу"],
  ["в зале славы", "в сокровищнице"],
  ["из зала", "из сокровищницы"],
  ["Зал славы", "Сокровищница"],
  ["Связи", "Друзья"],
  ["связи", "друзья"],
  ["связей", "друзей"],
  ["Появилась связь", "Появился друг"],
];

const renamed = (line: string) =>
  RENAME_62.reduce((acc, [was, now]) => acc.split(was).join(now), line);

/**
 * ОСОЗНАННЫЕ РАСХОЖДЕНИЯ С ПАКЕТОМ. Строки, где продукт говорит НЕ так, как
 * доска. Пусто по умолчанию: слово дизайна сильнее нашего вкуса, и тест ниже
 * это стережёт.
 *
 * ЗАЧЕМ СПИСОК. У расхождения по решению владельца два нечестных исхода:
 * тест падает на каждом прогоне (и его начинают пропускать глазами) или
 * ожидание тихо подгоняют под факт — и тогда следующая случайная правка
 * словаря проедет незамеченной. Список — третий путь: расхождение названо
 * поимённо, объяснено и по-прежнему под замком.
 *
 * ОБРАЗЕЦ — `TabBar.settings` (тикет 52): доска звала вкладку «Профилем»,
 * слово из столбца «не говорим» их же памятки; мы заменили его, записали
 * причину в списке сирот ниже и запросили замену письмом
 * design/ANSWERS-turn-25.md. Здесь та же форма, только причина другая.
 *
 * ПРИЧИНА ЗДЕСЬ ОДНА НА ВСЕ ПЯТНАДЦАТЬ СТРОК: имена двух разделов поменял
 * не редактор, а владелец продукта (06.08.2026, тикет 62). Вернуть слова
 * доски может только он же.
 *
 * ЗАПРОС ДИЗАЙНУ (в письмо следующего раунда): перевыпустить
 * `handoff/messages-ru.json` с новыми именами разделов — «Друзья» вместо
 * «Связи», «Сокровищница» вместо «Зала славы», включая падежные формы внутри
 * фраз. Приедет обновлённый пакет — эти пятнадцать записей обязаны отсюда
 * уйти, и тест «записанное расхождение — настоящее» заметит, если забудут.
 */
const PACKAGE_DRIFT: readonly string[] = [
  "Connections.empty",
  "Connections.filtersAria",
  "Connections.originGiftOneHall",
  "Connections.title",
  "DataSection.deleteWarn",
  "DataSection.exportHint",
  "Hall.title",
  "Occasion.connectionAppeared",
  "Occasion.hint",
  "Occasion.receivedRow",
  "Occasion.receivedRowNoName",
  "Room.connectionsLink",
  "Room.hallLink",
  "Settings.itemHallAdd",
  "Settings.itemHallRemove",
];

/**
 * ПЕРЕПИСАНО ПО РЕШЕНИЮ ВЛАДЕЛЬЦА — второй, отдельный список расхождений.
 *
 * Чем отличается от `PACKAGE_DRIFT`: там строка совпадает с доской слово в
 * слово после переименования двух разделов, и это стережёт третья проверка.
 * Здесь поменялось само содержание — механика, которую строка описывала, у
 * доски другая. Смешивать их нельзя: под общим «владелец решил» тогда проехала
 * бы любая переписанная фраза.
 *
 * ПРИЧИНА ОДНА НА ОБЕ СТРОКИ — приёмка 08.08.2026 (тикет 89). Владелец
 * назвал прежнюю механику витрины странной, и она такой была: кнопка одна,
 * «Убрать с витрины», а вещь при этом не убиралась никуда — возвращалась в
 * свою зону. Стало три действия (глазок, убрать, удалить), и подписи обязаны
 * их различать:
 * - `Hall.remove` — «Убрать из сокровищницы» вместо «Убрать с витрины»:
 *   рядом появился глазок, который тоже «убирает с витрины», только у гостей;
 * - `Hall.empty` — дорога в сокровищницу перестала быть одна. Прежний текст
 *   звал только в зону («Свою вещь можно поставить на витрину из её зоны»),
 *   а теперь вещь кладётся прямо отсюда.
 *
 * ЗАПРОС ДИЗАЙНУ (в письмо следующего раунда): доска механику разделения не
 * рисовала вовсе — просим экран витрины с тремя действиями и слова к ним.
 * Приедет — эти записи обязаны отсюда уйти.
 */
const OWNER_REWRITE_89: readonly string[] = ["Hall.empty", "Hall.remove"];

describe("словарь и дизайн-пакет", () => {
  it("каждая строка пакета перенесена дословно — кроме записанных расхождений", () => {
    const allowed = new Set([...PACKAGE_DRIFT, ...OWNER_REWRITE_89]);
    const drift = [...handoff]
      .filter(([key, value]) => ru.get(key) !== value && !allowed.has(key))
      .map(
        ([key, value]) =>
          `${key}: в продукте ${JSON.stringify(ru.get(key))}, в пакете ${JSON.stringify(value)}`,
      );
    expect(drift).toEqual([]);
  });

  it("записанное расхождение — настоящее, а не выданная вперёд индульгенция", () => {
    // Ключ, который на самом деле совпадает с пакетом, разрешал бы менять эту
    // строку как угодно и навсегда. Такой записи здесь не место.
    const stale = [...PACKAGE_DRIFT, ...OWNER_REWRITE_89]
      .filter((key) => !handoff.has(key) || ru.get(key) === handoff.get(key))
      .sort();
    expect(stale).toEqual([]);
  });

  it("расхождение — только переименование двух разделов, слово в слово", () => {
    // Самая важная из трёх: под общим «владелец решил» нельзя протащить
    // переписанную заодно фразу. Берём строку доски, применяем ровно замены
    // тикета 62 — обязано получиться то, что стоит в словаре.
    const rewritten = PACKAGE_DRIFT.filter(
      (key) => renamed(handoff.get(key) ?? "") !== ru.get(key),
    ).map(
      (key) =>
        `${key}: в продукте ${JSON.stringify(ru.get(key))}, из пакета переименованием выходит ${JSON.stringify(renamed(handoff.get(key) ?? ""))}`,
    );
    expect(rewritten).toEqual([]);
  });

  it("служебная пометка пакета в продукт не уехала", () => {
    // `_tone` — записка дизайна самому себе. В словаре она стала бы лишним
    // килобайтом в разметке каждой страницы.
    expect(ruRaw).not.toHaveProperty("_tone");
    expect(enRaw).not.toHaveProperty("_tone");
  });

  it("ключи, которых пакет не знает, — только экраны входа по ссылке", () => {
    // Тикет 19 добавил эти экраны уже после того, как дизайн собрал словарь.
    // Тексты для них написаны руками по формуле ошибок из памятки. Список
    // закреплён, чтобы новая «сирота» не проехала мимо дизайна незамеченной.
    //
    // `AddItem.saveHint` — не наша формулировка: подпись под выключенной
    // кнопкой взята дословно из макета (турн 23a, «Кнопка загорится, когда
    // появится название»). В messages-ru.json дизайн её не положил.
    //
    // `Scene.index*` и `Scene.summary*` — указатель зон и сводка (тикет 34).
    // Слова взяты из макета (турн 17a: «Цена», «Марки», «ещё») и из ответа
    // дизайна (handoff/answers-04.md: «Подойти ближе» вместо «войти» —
    // «войти» занято аккаунтом; «можно подарить» — гостевая половина строки
    // счётчиков). В messages-ru.json дизайн их пока не положил.
    //
    // `Shop.*` — блок «Где купить» (тикет 37). Слова взяты из макета дословно
    // (турн 8b: заголовок блока и «Перейти →»; стрелка внутри строки —
    // типографская, турн 12a отдельно оговаривает, что это часть текста, а
    // не иконка). В messages-ru.json дизайн их не положил: доска рисовала
    // блок на несколько магазинов, а у вещи ссылка одна.
    //
    // `Settings.item*` (Edit/Since/GiverRow/PriceHidden) — карточка вещи
    // хозяйки (тикет 39). Слова из макета (турн 8c: «В комнате с», «Подарил»,
    // «Цена · Скрыта»), кроме одного: «Подарил» переписано в «Подарок от» —
    // родовая форма запрещена памяткой тона, и сам пакет всюду говорит
    // «Подарок от {giver}». Экрана карточки в messages-ru.json нет.
    //
    // `Scene.noOpenFrame` в этом списке БОЛЬШЕ НЕТ (тикет 59). Он был сиротой
    // по убыли: раунд 4 УБРАЛ строку из пакета («noOpenFrame убран в раунде 3
    // (§7 брифа): не сообщаем человеку о том, чего у нас нет»), а продукт
    // продолжал её показывать в панели зоны у 91 зоны без кадра. Тикет 59 убрал
    // сам показ, и ключ ушёл из словаря следом — «пометка о том, что строка не
    // показывается» стоила бы килобайта в разметке КАЖДОЙ страницы (правило
    // выше), а сирота без употребления рано или поздно вернулась бы в UI как
    // «готовая строка». Текст не потерян: он записан в ADR-0005 и в
    // design/package/handoff/messages-ru.json (`Scene._removed`).
    //
    // `GuestRoom.occasion*`, `GuestRoom.freeGifts`, `GuestRoom.noSignup` и
    // `Booking.offer*` — приветствие холодного гостя и предложение собрать
    // свою комнату (тикет 38). Слова с доски дословно, где они там были:
    // «Регистрация не нужна · {name} не узнает, кто смотрел» и «подарков ещё
    // свободны» (турн 12b), «А когда твой день рождения?», «Соберём такую же
    // комнату — чтобы друзьям не приходилось угадывать», «Собрать свою
    // комнату», «Потом» (турн 12c). Отсчёт до праздника доска писала как
    // «День рождения через 12 дней»; у нас он говорит «Праздник через 12
    // дней» — комната хранит дату, но не знает, что это за праздник, и
    // обещать «день рождения» было бы враньём у половины комнат.
    // `Onboarding.nameLabel` и `Onboarding.emailNote` — оттуда же (турн 12c:
    // «Как тебя зовут», «взяли из брони», «Вход потом по той же почте…
    // Пароль придумывать не надо»). В messages-ru.json дизайн эти экраны не
    // положил: словарь пакета собирали до турна 12.
    //
    // `Onboarding.next` и `Onboarding.occasion*` — третий шаг онбординга,
    // дата праздника (тикет 43). Доска просит три вопроса (турн 11d), но
    // словами про дату дизайн-пакет не занимался: в messages-ru.json есть
    // только два первых шага. Тексты написаны по памятке — «Пока не знаю»
    // вместо молчаливого пропуска, «Кнопка загорится, когда появится дата»
    // теми же словами, что и подпись у выключенной кнопки добавления вещи.
    //
    // `Goal.*` — копилка на мечту в зоне «Просто деньги» (тикет 44, ADR-0008).
    // С доски (турн 8d) взяты дословно «Основное желание», «Собрано {percent}%»
    // и «{count} человек уже скинулись», а также обе галочки-обещания:
    // «{name} не увидит, кто сколько дал» (на доске «Ирина не видит, кто
    // сколько отправил» — «отправил» ушло вместе с переводом, который мы не
    // делаем) и «Гости не видят друг друга». Остальное написано по памятке:
    // словаря пакета для этой зоны нет вовсе — до ADR-0008 у неё не было ни
    // экрана, ни сценария. «Быстрых сумм» и «Отправить 3 000 ₽» с доски здесь
    // нет и не будет: это платёж (PRD §12а).
    //
    // `Hall.*` (цена, значок «кто видит», сумма) и `Settings.hall*` —
    // стоимость подарков (тикет 35). Слова взяты с доски дословно
    // (турн 12d: «Всем, у кого есть ссылка», «Только друзьям», «Только мне»,
    // «Никому — цен нет вообще», «Сумма всего зала», «Кто подарил»,
    // «Округлять цены», «около 60 000» вместо 62 000, и подпись значка
    // «видят друзья»). Экрана настроек в messages-ru.json дизайн не
    // положил — словарь пакета собирали до турна 12.
    //
    // ЧЕТЫРЕ ИЗ НИХ переименованы тикетом 62 вслед за самим разделом:
    // `Settings.hallOverline` («Зал славы» → «Сокровищница»),
    // `hallTotalLabel` («Сумма всего зала» → «Сумма всей сокровищницы»),
    // `hallItemHint` («весь зал» → «вся сокровищница»), `hallFriendsHint`
    // («Связи появляются…» → «Друзья появляются…»). В пакете этих ключей
    // нет, поэтому в списке расхождений (PACKAGE_DRIFT) их тоже нет —
    // сверять не с чем. Причина та же: решение владельца 06.08.2026.
    //
    // `Scene.summaryFree*` — зонный счётчик гостя, строки турна 25d (тикет 51),
    // дословно из новой поставки дизайна (zoneCounterGuest.cases): «все {m}
    // свободны», «{n} из {m} свободны», «1 из {m} свободна», «все {m} уже
    // дарят», «вещь одна и свободна». Показываются ТОЛЬКО гостю — у хозяйки
    // то же место занято числом вещей (инвариант №1); случай «пока пусто»
    // не дублирован: он уже живёт в `Scene.summaryEmpty`. Обновлённый
    // handoff/messages-ru.json ещё не принят (приёмка словаря пакета —
    // отдельный тикет), поэтому ключи пока сироты.
    //
    // `Booking.pool*` — строки складчины из того же турна 25d: прогресс,
    // сроки и исходы, которые проходят инварианты (прогресс сбора виден
    // только гостям, ADR-0008). НЕ перенесены и ждут решения владельца или
    // правки дизайна: строки с именами участников («в складчине Аня…») —
    // вопрос В4 реестра ещё открыт; «не собрали — деньги вернулись» —
    // спорит с PRD §12а (деньги через сервис не ходят, возвращать нечего).
    // Сам механизм складчины — Phase 2 (`POOL_NOT_SUPPORTED`).
    //
    // `SignIn.brand`, `.manifestTitle`, `.manifestBody`, `.emailPlaceholder`,
    // `.noPassword`, `.sentTitle`, `.sentBody`, `.resendIn`, `.resend`,
    // `.otherEmail`, `.notArrived`, `.spamHint`, `.back` — вход по турну 13a
    // (тикет 56). Слова с доски дословно: «Тихое пространство», «Комната,
    // а не список», «Обставь пространство тем, что любишь и что хотела бы
    // получить. Друзьям больше не придётся угадывать», «твоя@почта.ru»,
    // «Без пароля. Комната приватна, пока не дашь ссылку», «Письмо ушло»,
    // «Внутри одна ссылка. Откроешь — комната твоя, вводить ничего не надо»,
    // «Отправить снова через 0:42» (у нас — {time}), «Другая почта»,
    // «Письмо не пришло?». Отступления от доски: `spamHint` — только первое
    // предложение подсказки («Проверь папку «Спам»»): вторая половина зовёт
    // ввести код из письма, а наше письмо несёт ссылку, кода в нём нет
    // (вердикт по коду — тикет 56, Comments); `resend` — состояние кнопки
    // после таймера, доска его не рисовала; `back` — подпись стрелки
    // возврата для читалки, на доске это иконка без слов. Переносы строк
    // в `brand` и `manifestTitle` — с доски (там «Тихое<br>пространство»),
    // хранятся в словаре, а не в разметке. В messages-ru.json дизайн экрана
    // входа не положил: словарь пакета собирали до турна 13.
    //
    // `TabBar.*` — подписи вкладок таб-бара (тикет 52, турн 25a): «Комната»,
    // «Друзья», «Добавить» — дословно с доски (25a и её же сетка иконок).
    // `TabBar.hall` — БОЛЬШЕ НЕ дословно: доска подписала вкладку «Залом
    // славы», с 06.08.2026 раздел зовётся «Сокровищницей» (решение владельца,
    // тикет 62). Ключ пакет не знает, сверять не с чем; та же замена в
    // строках, которые пакет знает, записана в PACKAGE_DRIFT выше.
    // `TabBar.settings` — НЕ с доски: там вкладка звалась
    // «Профилем», а это слово из столбца «не говорим» их же памятки (правило
    // выше и ловит), замена запрошена письмом design/ANSWERS-turn-25.md;
    // до ответа — имя страницы /settings («Настройки», как Settings.title).
    // `TabBar.tabsAria` — имя полосы для читалки, слов такого экрана в
    // словаре пакета нет.
    //
    // `RoomList.*` — «вся комната списком» (тикет 67): второй вход в то же
    // содержимое для тех, кто не хочет гулять по комнате. Доска нарисовала
    // экран РАУНДОМ 13 — турн 29a, — но в `messages-ru.json` дизайн слов не
    // положил: словарь пакета собирали до турна 29.
    //
    // С экрана взято дословно: «Моя комната» (заголовок 29a), «Комната» и
    // «Список» (переключатель там же). Остальное — по памятке тона: «Все» как
    // третье положение фильтра (два первых, «Хочу» и «Люблю», пакет знает по
    // вкладкам сетки зоны), «Здесь пока пусто» — формула пустого состояния.
    // `viewAria` и `filterAria` — имена групп для читалки, на доске это
    // графика без слов.
    const own = [...ru.keys()].filter((key) => !handoff.has(key)).sort();
    expect(own).toEqual([
      "AddItem.back",
      // Тикет 89: карточка добавления, открытая С ВИТРИНЫ (?hall=1). Выхода
      // на витрину и её заголовка доска не рисовала — она вообще не знает,
      // что вещь можно положить в сокровищницу сразу, минуя зону.
      "AddItem.backToHall",
      "AddItem.backToRoom",
      "AddItem.hallHint",
      "AddItem.hallLabel",
      "AddItem.saveHint",
      // Услуга-впечатление (тикет 97): подсказки полей «Когда» и «Где».
      // Примеры с доски («выходные», «онлайн»), самих подписей полей в
      // пакете нет — экрана впечатления дизайн словами не занимался.
      "AddItem.whenPlaceholder",
      "AddItem.wherePlaceholder",
      // Тикет 76: два новых отказа брони. Пакет знает `errTaken`/`errRate`/
      // `errValidation`/`errGeneric`, а этих двух у него нет — оба про случаи,
      // которых доска не рисовала. `errOwn` — владелец открыл СВОЮ комнату по
      // гостевой ссылке (он на приёмке 07.08 в это и упёрся, получив безымянный
      // отказ); `errGone` — вещь пропала между показом и нажатием. Написаны по
      // памятке: говорим, ЧТО случилось, и что делать дальше.
      "Booking.errGone",
      "Booking.errOwn",
      // Ссылка «Подробнее» из сетки в карточку вещи гостя (тикет 91).
      "Booking.itemMore",
      "Booking.offerBody",
      "Booking.offerDateHint",
      "Booking.offerDateLabel",
      "Booking.offerEmailHint",
      "Booking.offerEmailLabel",
      "Booking.offerErr",
      "Booking.offerErrEmail",
      "Booking.offerLater",
      "Booking.offerSentBody",
      "Booking.offerSentTitle",
      "Booking.offerSubmit",
      "Booking.offerSubmitBusy",
      "Booking.offerTitle",
      "Booking.poolDaysLeft",
      "Booking.poolFull",
      "Booking.poolJoin",
      "Booking.poolJoinAmount",
      "Booking.poolLastDay",
      "Booking.poolProgress",
      "Booking.poolShort",
      // poolWho*: имена участников складчины друг другу — решение владельца
      // 06.08.2026 (вопрос В4 закрыт). Хозяйке — только после праздника.
      "Booking.poolWho1",
      "Booking.poolWho2",
      "Booking.poolWhoMany",
      "Booking.poolWhoYou",
      // Brand.name — имя площадки «Grace» (решение владельца 06.08.2026,
      // тикет 56). Один ключ на весь продукт: сейчас его набирает текстом
      // временный вордмарк входа (Archivo) и тайтлы /signin, когда приедет
      // SVG-логотип дизайнера — замена в одном месте.
      "Brand.name",
      // Тикет 95 (доска Б7, турн 11e): лента друзей по близости праздника.
      // Отсчёт до праздника и «сколько ещё можно подарить» — смысл с доски,
      // словами этого экрана дизайн не занимался.
      "Connections.feedFree",
      "Connections.feedInDays",
      "Connections.feedNoDate",
      "Connections.feedToday",
      // Тикет 98 (доска Б12, турн 20a): «Остаться на связи?» после праздника.
      // Экрана согласия НЕТ НИ В ОДНОМ пакете дизайна — это первый вопрос
      // задания 16 (BRIEF-19). С доски дословно взяты только заголовок
      // («Остаться на связи?») и форма кнопки «Со всеми {count}»; остальное
      // написано по памятке тона. Отдельно: доска рисует вопрос лишь со
      // стороны хозяйки, а спрашиваем мы обоих — «разрешение у обеих сторон»
      // её же словами, и второй стороне нужен тот же словарь.
      "Consent.agree",
      "Consent.agreeAll",
      "Consent.badge",
      "Consent.decline",
      "Consent.errGeneric",
      "Consent.hint",
      "Consent.nameFallback",
      "Consent.rowGift",
      "Consent.rowPlain",
      "Consent.title",
      "Consent.waiting",
      // Пустая зона (тикет 99, доска Б27 · турн 25c). Числа и смысл — из
      // `task15.json → emptyStates.emptyZone`, слова оттуда же дословно:
      // «Положить сюда первую», «Убрать полку из комнаты», «полка 02 из 13 ·
      // пока пусто» и вся строка body. Два отступления: заголовок у доски
      // назван зоной («Здесь встанут твои украшения»), а у нас имя зоны уже
      // стоит в шапке экрана — повторять его значит склонять девятнадцать
      // ярлыков по падежам; и `removeSub` дописан второй половиной («вещи
      // останутся»), потому что `setZoneOff` вещи НЕ трогает, а кнопка без
      // этой строки читается как удаление.
      "EmptyZone.body",
      "EmptyZone.compactBody",
      "EmptyZone.cta",
      "EmptyZone.errGeneric",
      "EmptyZone.position",
      "EmptyZone.removeSub",
      "EmptyZone.removeTitle",
      "EmptyZone.title",
      // Услуга-впечатление (тикет 97, доска Б20 · турн 8e): «Когда · Где ·
      // Годен до», плашка вышедшего срока и два действия хозяйки. Слова с
      // доски по смыслу; в messages-ru.json этого экрана нет.
      "Experience.certHint",
      "Experience.expiredGuest",
      "Experience.expiredOwner",
      "Experience.extend",
      "Experience.takeOff",
      "Experience.validUntil",
      "Experience.when",
      "Experience.where",
      "Goal.amountLabel",
      "Goal.badge",
      "Goal.cancel",
      "Goal.collected",
      "Goal.emailLabel",
      "Goal.errAlready",
      "Goal.errGeneric",
      "Goal.guestEmpty",
      "Goal.join",
      "Goal.joinConfirm",
      "Goal.joined",
      "Goal.joining",
      "Goal.leave",
      "Goal.nameLabel",
      "Goal.of",
      "Goal.ownerChange",
      "Goal.ownerClear",
      "Goal.ownerEmptyHint",
      "Goal.ownerEmptyTitle",
      "Goal.ownerQuiet",
      "Goal.ownerSet",
      "Goal.participants",
      "Goal.pledgeAmountLabel",
      "Goal.pledgeHint",
      "Goal.promiseDirect",
      "Goal.promiseNames",
      "Goal.promiseQuiet",
      "Goal.revealedRow",
      "Goal.save",
      "Goal.saving",
      "Goal.titleLabel",
      "Goal.titlePlaceholder",
      // Карточка вещи глазами ГОСТЯ (тикет 91, доска А2 + Б24, турн 25b) —
      // единственный экран из списка P0 доски, который до сих пор не был
      // построен. Слова с доски 25b: хлебная крошка «Украшения · комната
      // Милы» и замочек-обещание «Мила увидит только „одну вещь забрали"».
      // В messages-ru.json пакета этого экрана нет: словарь собирали до 25.
      "GuestItem.back",
      "GuestItem.crumb",
      "GuestItem.loveCaption",
      "GuestItem.notFound",
      "GuestItem.noteLabel",
      "GuestItem.promise",
      "GuestItem.takenHint",
      "GuestItem.takenTitle",
      "GuestRoom.freeGifts",
      "GuestRoom.noSignup",
      "GuestRoom.occasionIn",
      "GuestRoom.occasionToday",
      "GuestRoom.occasionTomorrow",
      // Тикет 89: три действия витрины вместо одного и прямая дорога сюда.
      // Доска рисовала витрину с единственным «Убрать с витрины» и не знала
      // ни глазка (скрыть от гостей), ни удаления, ни «Добавить вещь».
      // `actionsHint` — одна строка на всю витрину: три действия похожи на
      // вид и расходятся по последствиям, подпись под каждой кнопкой была бы
      // шумом. Написано по памятке тона.
      "Hall.actionsHint",
      "Hall.add",
      "Hall.delete",
      "Hall.deleteConfirm",
      // Пояснение под вопросом (раунд 19): отвечает на страх «удалением я
      // сотру и историю подарка» — не сотрёт, друг остаётся в «Друзьях».
      "Hall.deleteConfirmBody",
      "Hall.deleteNo",
      "Hall.deleteYes",
      // Тикет 92 (доска Б22): заметка хозяйки цитатой прямо на витрине —
      // «Ждала её два года…». Ёлочки живут в словаре, а не в разметке: в
      // английском каркасе кавычки другие. `edit`/`noteAdd` — дорога в
      // карточку вещи: до тикета 92 с витрины не вело ничего, и написать
      // заметку там, где её видно, было нельзя. Словами витрины дизайн не
      // занимался: в messages-ru.json у раздела всего одиннадцать ключей.
      "Hall.edit",
      // Тикет 93 (доска А5): витрина глазами гостя. Экрана в пакете нет —
      // словарь собирали, когда гостевого маршрута не существовало вовсе.
      // Заголовок говорит именем хозяйки: гость пришёл смотреть на неё.
      "Hall.guestBack",
      "Hall.guestEmpty",
      // «Всё здесь уже дома» — дословно из поставки раунда 19.
      "Hall.guestSubtitle",
      "Hall.guestTitle",
      "Hall.hiddenBadge",
      "Hall.hide",
      "Hall.noteAdd",
      "Hall.noteQuote",
      "Hall.priceAbout",
      "Hall.priceHide",
      "Hall.priceSeenAria",
      "Hall.priceShow",
      // «вернётся в свою зону — в „{зона}“» из поставки раунда 19: подсказка
      // называет зону по имени, и «убрать» перестаёт путаться с «удалить».
      "Hall.removeHint",
      "Hall.seenALL",
      "Hall.seenFRIENDS",
      "Hall.seenITEM",
      "Hall.seenME",
      "Hall.seenNONE",
      "Hall.show",
      "Hall.toHall",
      "Hall.total",
      "Hall.totalRounded",
      "Onboarding.emailNote",
      "Onboarding.nameFromBooking",
      "Onboarding.nameLabel",
      "Onboarding.next",
      "Onboarding.occasionButtonHint",
      "Onboarding.occasionLabel",
      "Onboarding.occasionSkip",
      "Onboarding.occasionSkipHint",
      "Onboarding.occasionStep",
      "Onboarding.occasionSubtitle",
      "Onboarding.occasionTitle",
      // Тикет 94 (доска Б8, турн 13b): просьба укрепить аккаунт перед первым
      // шером. С доски дословно «Комнату теперь есть чем терять» и
      // «Поделиться без этого» — отказ разрешён и на доске тоже. Остальное по
      // памятке: словами этого экрана дизайн не занимался, в messages-ru.json
      // его нет.
      "Room.hardenBody",
      "Room.hardenLink",
      "Room.hardenOverline",
      "Room.hardenSkip",
      "Room.sharePlaque",
      "RoomList.empty",
      "RoomList.filterAll",
      "RoomList.filterAria",
      "RoomList.filterLove",
      "RoomList.filterWant",
      "RoomList.subtitle",
      "RoomList.title",
      "RoomList.toList",
      "RoomList.toRoom",
      "RoomList.viewAria",
      // Пустая комната гаснет (тикет 104): подпись обещает, что свет
      // включится сам, и заменяет «коснись зоны» — касаться нечего.
      "Scene.emptyRoom",
      "Scene.indexAria",
      "Scene.summaryBrands",
      "Scene.summaryCountsGuest",
      "Scene.summaryEmpty",
      "Scene.summaryEnter",
      "Scene.summaryFreeAll",
      "Scene.summaryFreeLast",
      "Scene.summaryFreeNone",
      "Scene.summaryFreeSingle",
      "Scene.summaryFreeSome",
      "Scene.summaryMore",
      "Scene.summaryPrice",
      // Раздел «Вход и доступ» (тикет 94): доска 13b рисовала «Способы войти —
      // основной вход · подтверждён / резервный вход · не добавлены», отсюда
      // и подписи. Пояснение под ними наше: доска объясняла это картинкой.
      "Settings.accessHint",
      "Settings.accessOverline",
      "Settings.accessPrimaryConfirmed",
      "Settings.accessPrimaryUnconfirmed",
      "Settings.accessSecond",
      "Settings.accessSecondLinked",
      "Settings.accessSecondNone",
      "Settings.hallFriendsHint",
      "Settings.hallGiverHint",
      "Settings.hallGiverLabel",
      "Settings.hallItemHint",
      "Settings.hallOverline",
      "Settings.hallPriceLabel",
      "Settings.hallRoundHint",
      "Settings.hallRoundLabel",
      "Settings.hallTotalHint",
      "Settings.hallTotalLabel",
      "Settings.hallVisALL",
      "Settings.hallVisFRIENDS",
      "Settings.hallVisME",
      "Settings.hallVisNONE",
      // Свет и время суток (тикет 96, доска Б6): две последние ручки
      // персонализации. Доска рисовала сегменты, словами дизайн их не
      // подписывал — названия положений наши, по памятке.
      "Settings.itemEdit",
      "Settings.itemGiverRow",
      "Settings.itemPriceHidden",
      "Settings.itemSince",
      "Settings.lightColorLabel",
      "Settings.lightHint",
      "Settings.lightOverline",
      "Settings.light_candle",
      "Settings.light_warm",
      "Settings.light_white",
      "Settings.todLabel",
      "Settings.tod_day",
      "Settings.tod_dusk",
      "Settings.tod_morning",
      "Settings.tod_night",
      "Shop.aria",
      "Shop.go",
      "Shop.title",
      "SignIn.back",
      "SignIn.brand",
      "SignIn.confirmBody",
      "SignIn.confirmOverline",
      "SignIn.confirmSubmit",
      "SignIn.confirmTitle",
      "SignIn.emailPlaceholder",
      "SignIn.expiredBody",
      "SignIn.expiredTitle",
      "SignIn.failedBody",
      "SignIn.failedTitle",
      "SignIn.manifestBody",
      "SignIn.manifestTitle",
      "SignIn.newLink",
      "SignIn.noPassword",
      "SignIn.notArrived",
      "SignIn.otherEmail",
      "SignIn.resend",
      "SignIn.resendIn",
      "SignIn.sentBody",
      "SignIn.sentTitle",
      "SignIn.spamHint",
      "TabBar.add",
      "TabBar.connections",
      "TabBar.hall",
      "TabBar.room",
      "TabBar.settings",
      "TabBar.tabsAria",
      // Экран зоны списком (тикет 74, турн 29b): чипы порядка, выбор вещей,
      // массовое скрытие и гостевой фильтр «только свободные». Слова с доски
      // 29b дословно («по дате», «по цене», «скрытые», «Скрыть 2 вещи»,
      // «только свободные»); в messages-ru.json пакета этого экрана нет —
      // словарь собирали до турна 29.
      "ZoneList.cancel",
      "ZoneList.counts",
      "ZoneList.emptyFree",
      "ZoneList.freeOnly",
      "ZoneList.hideMany",
      "ZoneList.select",
      "ZoneList.selectAria",
      "ZoneList.selectDone",
      "ZoneList.selected",
      "ZoneList.sortAria",
      "ZoneList.sortDate",
      "ZoneList.sortHidden",
      "ZoneList.sortPrice",
    ]);
  });
});

describe("полнота словарей", () => {
  it("наборы ключей ru и en совпадают", () => {
    // Каркас en обязан быть полным: next-intl падает на пропущенном ключе.
    const onlyRu = [...ru.keys()].filter((key) => !en.has(key)).sort();
    const onlyEn = [...en.keys()].filter((key) => !ru.has(key)).sort();
    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] });
  });

  it("секции совпадают и по составу", () => {
    expect(Object.keys(enRaw).sort()).toEqual(Object.keys(ruRaw).sort());
  });
});
