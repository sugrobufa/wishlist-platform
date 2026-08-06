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

describe("словарь и дизайн-пакет", () => {
  it("каждая строка пакета перенесена дословно", () => {
    const drift = [...handoff]
      .filter(([key, value]) => ru.get(key) !== value)
      .map(
        ([key, value]) =>
          `${key}: в продукте ${JSON.stringify(ru.get(key))}, в пакете ${JSON.stringify(value)}`,
      );
    expect(drift).toEqual([]);
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
    // `Scene.noOpenFrame` — наоборот, сирота по убыли: раунд 4 УБРАЛ строку из
    // пакета («noOpenFrame убран в раунде 3 (§7 брифа): не сообщаем человеку о
    // том, чего у нас нет»). В продукте она ещё живёт — её показывает панель
    // зоны у 91 зоны без кадра. Убрать вместе с самой подписью — тикет сцены,
    // не приёмка пакета (тикет 33, ADR-0005).
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
    // `Hall.*` (цена, значок «кто видит», сумма зала) и `Settings.hall*` —
    // стоимость в зале славы (тикет 35). Слова взяты с доски дословно
    // (турн 12d: «Всем, у кого есть ссылка», «Только друзьям», «Только мне»,
    // «Никому — цен нет вообще», «Сумма всего зала», «Кто подарил»,
    // «Округлять цены», «около 60 000» вместо 62 000, и подпись значка
    // «видят друзья»). Экрана настроек зала в messages-ru.json дизайн не
    // положил — словарь пакета собирали до турна 12.
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
    // «Друзья», «Добавить», «Зал славы» — дословно с доски (25a и её же
    // сетка иконок). `TabBar.settings` — НЕ с доски: там вкладка звалась
    // «Профилем», а это слово из столбца «не говорим» их же памятки (правило
    // выше и ловит), замена запрошена письмом design/ANSWERS-turn-25.md;
    // до ответа — имя страницы /settings («Настройки», как Settings.title).
    // `TabBar.tabsAria` — имя полосы для читалки, слов такого экрана в
    // словаре пакета нет.
    const own = [...ru.keys()].filter((key) => !handoff.has(key)).sort();
    expect(own).toEqual([
      "AddItem.back",
      "AddItem.backToRoom",
      "AddItem.saveHint",
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
      "GuestRoom.freeGifts",
      "GuestRoom.noSignup",
      "GuestRoom.occasionIn",
      "GuestRoom.occasionToday",
      "GuestRoom.occasionTomorrow",
      "Hall.priceAbout",
      "Hall.priceHide",
      "Hall.priceSeenAria",
      "Hall.priceShow",
      "Hall.seenALL",
      "Hall.seenFRIENDS",
      "Hall.seenITEM",
      "Hall.seenME",
      "Hall.seenNONE",
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
      "Scene.indexAria",
      "Scene.noOpenFrame",
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
      "Settings.itemEdit",
      "Settings.itemGiverRow",
      "Settings.itemPriceHidden",
      "Settings.itemSince",
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
