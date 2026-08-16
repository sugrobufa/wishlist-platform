import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ru from "../messages/ru.json";

const CARD = readFileSync(
  resolve(process.cwd(), "src/app/room/zone/[zone]/i/[id]/item-card.tsx"),
  "utf8",
);

/**
 * 243 — ИЗ ВЕЩИ СОКРОВИЩНИЦЫ «НАЗАД» ВЕДЁТ В СОКРОВИЩНИЦУ.
 *
 * Приёмка владельца 14.08.2026: «попадаю не в сокровищницу, а в список всей
 * категории, а потом вообще в комнату. Нелогично». Вход в карточку из витрины
 * один — перо-заметка, — а выход шёл в полку комнаты, которую человек не
 * открывал.
 *
 * Проверяется РАЗМЕТКОЙ, а не рендером: знак — `<Link href>`, и вся починка в
 * том, какой адрес в него подставлен. Рендерить карточку целиком ради одной
 * ссылки значило бы поднимать половину продукта.
 */
describe("243 — знак возврата ведёт туда, где вещь живёт", () => {
  it("адрес считается по месту вещи: витрина → сокровищница, комната → полка", () => {
    expect(CARD).toContain('const backHref = item.inHall ? "/room/hall" : zoneHref;');
    // Подпись знака едет вместе с адресом — иначе экран назывался бы полкой,
    // а вёл в сокровищницу.
    expect(CARD).toContain('const backLabel = item.inHall ? tHall("toHall") : zoneLabel;');
  });

  it("в самом знаке стоят backHref и backLabel, а не прежние zoneHref/zoneLabel", () => {
    expect(CARD).toContain("<Link href={backHref} aria-label={backLabel}");
    // Прежней связки в шапке не осталось: если она вернётся, вернётся и жалоба.
    expect(CARD).not.toContain("<Link href={zoneHref} aria-label={zoneLabel}");
  });

  it("строка «стоит в полке» осталась дорогой В ПОЛКУ — она не «назад»", () => {
    // Указание места вещи верно и для витрины: вернувшись в комнату, вещь
    // встанет именно туда. Подменить её на сокровищницу значило бы починить
    // жалобу и сломать смысл.
    expect(CARD).toContain("<Link href={zoneHref} className={`pressable ${s.shelfRow}`}>");
  });
});

/**
 * 242 — ПОДСКАЗКА СОКРОВИЩНИЦЫ ГОВОРИТ ПРО СВОЙ ЭКРАН.
 *
 * «Зачем писать, что в комнате. Просто напиши, что тут хранятся вещи такие-то и
 * такие» — слово владельца, та же приёмка.
 */
/**
 * 249 — В ЧУЖОЙ СОКРОВИЩНИЦЕ ПОДПИСЬ НЕ ГОВОРИТ «МОЁ».
 *
 * «При входе на сокровищницу хозяина подпись „уже моё" смущает. Оно не моё, а
 * его» — та же приёмка. Экран гостевой, а ключ брался хозяйкин: своего у
 * гостевой подписи не было вовсе.
 */
describe("249 — гостевая подпись витрины", () => {
  const GUEST_HALL = readFileSync(
    resolve(process.cwd(), "src/app/r/[slug]/hall/page.tsx"),
    "utf8",
  );

  it("гость видит свой ключ, а не хозяйкин", () => {
    expect(GUEST_HALL).toContain('t("captionMineGuest")');
    expect(GUEST_HALL).not.toContain('t("captionMine")');
  });

  it("слово не от первого лица и без рода", () => {
    const caption: string = ru.Hall.captionMineGuest;
    expect(caption).not.toMatch(/мо[её]|мои/iu);
    expect(caption).not.toMatch(/(ла|лась)/u);
    // Хозяйкина подпись при этом остаётся своей — её этот тикет не трогал.
    expect(ru.Hall.captionMine).toBe("уже моё");
  });
});

describe("242 — подсказка сокровищницы", () => {
  const hint: string = ru.Hall.ownerHint;

  it("не объясняет комнату — ни словом", () => {
    expect(hint.toLowerCase()).not.toContain("комнат");
  });

  it("не повторяет подпись счётчика — она стоит строкой выше", () => {
    // Первая редакция звучала «вещи, которые уже твои: подарки и собственные
    // покупки», и это поймал сторож витрины: «уже твои» уже написано в строке
    // «26 вещей · уже твои». Подсказка повторяла её слово в слово через 40
    // пикселей.
    expect(hint).not.toContain(ru.Hall.ownerSubtitle);
  });

  it("называет, что здесь лежит, и что этих вещей не дарят", () => {
    expect(hint).toContain("подарки");
    expect(hint).toContain("покупки");
    // Единственный факт, который человеку тут нужен (инвариант 8 устава).
    expect(hint).toMatch(/не дарят/u);
  });

  it("говорит на «ты» и без рода человека — правила сторожа тона", () => {
    expect(hint).not.toMatch(/\bвы\b|\bвас\b|\bваш/iu);
    // Прошедшее время с родовым окончанием — то, чем болели строки складчины.
    expect(hint).not.toMatch(/(ла|лась)\b/u);
  });
});

/**
 * 257 — ЗНАК «НАЗАД» В ВЕРХНЕМ УГЛУ КАДРА, А ПУСТАЯ ВИТРИНА ГОВОРИТ ДВУМЯ
 * СТРОКАМИ. Приёмка владельца 16.08.2026: «в пустой сокровищнице кнопка
 * „Вернуться" не на том месте, надо выше в угол. Также перепиши текст проще…
 * плюс пояснение что здесь хранится».
 *
 * ПОЧЕМУ ЗНАК СТОЯЛ НИЗКО. Он был первой строкой в той же коробке, что заголовок
 * и счётчик, — а она прижата к НИЗУ кадра. На полной витрине это читалось
 * шапкой, на пустой знак повисал у середины экрана. Отсюда и мера сторожа:
 * у знака СВОЯ коробка, и стоит она выше нижней в обоих состояниях и на обеих
 * витринах — место знака не может зависеть от того, есть ли вещи.
 *
 * Проверяется РАЗМЕТКОЙ и ПРАВИЛОМ CSS, а не рендером: обе страницы за одним
 * запросом ходят в БД, а вся починка — в том, какая коробка держит знак и от
 * чего считается её отступ. Рендерная половина витрины живёт отдельно
 * (tests/hall-owner-subtitle.test.ts) и своё правило показа стережёт сама.
 */
describe("257 — знак витрины уехал в верхний угол кадра", () => {
  const OWNER_HALL = readFileSync(resolve(process.cwd(), "src/app/room/hall/page.tsx"), "utf8");
  const GUEST_HALL = readFileSync(resolve(process.cwd(), "src/app/r/[slug]/hall/page.tsx"), "utf8");
  const HALL_CSS = readFileSync(
    resolve(process.cwd(), "src/components/hall/hall.module.css"),
    "utf8",
  );

  /** Тело правила `.name { … }` из текста CSS; null — правила нет. */
  const ruleOf = (css: string, name: string): string | null =>
    new RegExp(String.raw`^\.${name}\s*\{([^}]*)\}`, "mu").exec(css)?.[1] ?? null;

  const pages: ReadonlyArray<readonly [string, string]> = [
    ["хозяйки", OWNER_HALL],
    ["гостя", GUEST_HALL],
  ];

  for (const [whose, page] of pages) {
    it(`витрина ${whose}: знак в своей коробке, и она выше коробки заголовка`, () => {
      expect(page).toContain("${s.heroBack} mx-auto w-full max-w-3xl px-5 lg:px-0");
      expect(page).toContain("pressable ${s.heroBackLink}");
      // Поля у обеих коробок одни и те же: знак обязан стоять по одной левой
      // кромке с заголовком и на телефоне, и на десктопе.
      const signAt = page.indexOf("s.heroBack");
      const bottomBoxAt = page.indexOf("absolute inset-x-0 bottom-0");
      expect(bottomBoxAt, "нижняя коробка шапки пропала").toBeGreaterThan(-1);
      expect(signAt, "знак вернулся в нижнюю коробку").toBeGreaterThan(-1);
      expect(signAt).toBeLessThan(bottomBoxAt);
    });
  }

  it("отступ сверху считает вырез камеры, цель нажатия — 44", () => {
    const box = ruleOf(HALL_CSS, "heroBack");
    expect(box, "в hall.module.css нет правила .heroBack").not.toBeNull();
    expect(box).toMatch(/position:\s*absolute/u);
    expect(box).toMatch(/left:\s*0/u);
    // 12 — тот же отступ, что у знака в углу комнаты (`--imm-corner-top`);
    // инсет чёлки прибавлен по той же причине: под вырезом знака не нажать.
    expect(box).toMatch(/top:\s*calc\(12px \+ env\(safe-area-inset-top, 0px\)\)/u);

    const link = ruleOf(HALL_CSS, "heroBackLink");
    expect(link, "в hall.module.css нет правила .heroBackLink").not.toBeNull();
    expect(link).toMatch(/min-height:\s*var\(--hit-target-min, 44px\)/u);
  });
});

describe("257 — пустая витрина: обещание с действием и пояснение места", () => {
  const OWNER_HALL = readFileSync(resolve(process.cwd(), "src/app/room/hall/page.tsx"), "utf8");
  const GUEST_HALL = readFileSync(resolve(process.cwd(), "src/app/r/[slug]/hall/page.tsx"), "utf8");

  it("страница хозяйки рисует ОБЕ строки, а не одну", () => {
    expect(OWNER_HALL).toContain('{t("empty")}');
    expect(OWNER_HALL).toContain('{t("emptyHint")}');
  });

  it("обещание зовёт действием, а не зачитывает три дороги сюда", () => {
    const empty: string = ru.Hall.empty;
    expect(empty).toContain("добавь");
    // Перечисление нарушало устав самого дизайна (пакет 50): пустое состояние —
    // одно обещание и одно действие.
    expect(empty).not.toContain("Дошло");
    expect(empty).not.toMatch(/из зоны/u);
  });

  it("пояснение вмещает оба источника — купленное самой и подаренное", () => {
    const emptyHint: string = ru.Hall.emptyHint;
    // Подарки приезжают сюда сами, после «Дошло»: строка, называющая только
    // покупки, врала бы про половину витрины.
    expect(emptyHint).toMatch(/куплен/u);
    expect(emptyHint).toMatch(/подарен/u);
  });

  it("гостевая пустая витрина не тронута — у гостя нет действия", () => {
    expect(ru.Hall.guestEmpty).toBe("Здесь пока пусто — загляни попозже");
    expect(GUEST_HALL).toContain('t("guestEmpty")');
    expect(GUEST_HALL).not.toContain('t("emptyHint")');
  });
});
