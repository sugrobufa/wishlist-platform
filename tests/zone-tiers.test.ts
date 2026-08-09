// Ярусы ширины сетки зоны и мост из зоны в витрину (раунд 29 дизайна,
// `design/package/handoff/round29/task31.json`).
//
// ЗАЧЕМ ТЕСТ. Оба правила — ответы на вопросы, которые уже один раз стоили нам
// экрана, и оба легко «поправить обратно», не заметив.
//
// ЯРУСЫ. Владелец увидел зону, где вещей мало, и она выглядела пустой сеткой.
// Дизайн лечит это количеством места, а НЕ заголовками: «заголовков степеней
// нет никогда — делить список больше нечем, и это освобождение». Пороги 1–2 /
// 3–6 / 7+ его, не наши, и подобрать их заново «на глаз» — значит потерять
// довод: «мало вещей = каждой больше сцены».
//
// МОСТ. После отмены состояний половина вещей уехала на витрину, и зона
// похудела вдвое. Строка-подвал отвечает на «куда делась половина» — но
// ТОЛЬКО хозяйке и только если в витрине правда есть вещи ЭТОЙ зоны. Гостю
// моста нет: он не должен знать, что у хозяйки лежит за пределами комнаты, и
// его дверь в витрину — знак в углу.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gridTier } from "../src/components/zone/ZoneGrid";
import task31 from "../design/package/handoff/round29/task31.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const gridCss = read("../src/components/zone/zone-grid.module.css");
const zoneGrid = read("../src/components/zone/ZoneGrid.tsx");
const ownerPage = read("../src/app/room/page.tsx");
const guestPage = read("../src/app/r/[slug]/page.tsx");
const items = read("../src/server/services/items.ts");

describe("ярусы ширины — пороги дизайна, а не подобранные", () => {
  it("контракт раунда 29 лежит в репозитории и говорит теми же числами", () => {
    // Пакет живёт на машине владельца и может исчезнуть — нужное копируется
    // сюда сразу. Читаем ключи, а не пересказываем их.
    expect(Object.keys(task31.gridTiers.tiers)).toEqual(["1-2", "3-6", "7+"]);
  });

  it("1–2 вещи — во всю ширину, 3–6 — лидер плюс двухколонник, 7+ — плотно", () => {
    expect([1, 2].map(gridTier)).toEqual(["wide", "wide"]);
    expect([3, 4, 5, 6].map(gridTier)).toEqual(["lead", "lead", "lead", "lead"]);
    expect([7, 12, 50].map(gridTier)).toEqual(["dense", "dense", "dense"]);
  });

  it("пустая зона в ярус не попадает — у неё свой экран из трёх мест", () => {
    // Порог считается по тому, что реально рисуется; ноль сюда не доходит,
    // но и не должен ломать функцию.
    expect(gridTier(0)).toBe("wide");
  });

  it("ярус выбирается по ЧИСЛУ ПОКАЗАННЫХ вещей, а не по приехавшим", () => {
    expect(zoneGrid).toContain("gridTier(shown.length)");
  });

  it("числа яруса живут в CSS: пропорции кропа и постоянный воздух", () => {
    // 1–2: фото 348×196 — это 16:9. 3–6: лидер 348×150. Пропорцией, а не
    // пикселями: колонка резиновая, отношение сторон одно на любой ширине.
    expect(gridCss).toMatch(/\.tierWide \.media \{\s*aspect-ratio: 16 \/ 9;/u);
    expect(gridCss).toMatch(
      /\.tierLead > li:first-child \.media \{\s*aspect-ratio: 348 \/ 150;/u,
    );
    expect(gridCss).toMatch(/\.tierLead > li:first-child \{\s*grid-column: 1 \/ -1;/u);
    // «Воздух постоянный (gap 8), режимов от количества у него нет».
    expect(gridCss).toMatch(/\.grid \{[\s\S]*?gap: 8px;/u);
  });

  it("на десктопе ярусы гасятся: там «во всю ширину» означает другое число", () => {
    // Десктопный лист идёт во всю ширину окна, и плитка «во всю ширину» дала
    // бы фотографию под 900 px — потолок листа (тикет 60) посчитан от ряда в
    // 196. Ярусы — телефонное правило, 348 это ширина телефонного листа.
    const desktop = gridCss.slice(gridCss.indexOf("@media (min-width: 1024px)"));
    expect(desktop).toMatch(/\.tierWide \{\s*grid-template-columns: repeat\(auto-fill/u);
    expect(desktop).toMatch(/\.tierLead > li:first-child \{\s*grid-column: auto;/u);
    expect(desktop).toMatch(/aspect-ratio: 1 \/ 1;/u);
  });

  it("ЗАГОЛОВКОВ ПО СТЕПЕНЯМ НЕТ НИКОГДА", () => {
    // Единственные законные заголовки — имена зон в списке комнаты; в самой
    // сетке делить нечем. Вкладки состояний тоже не вернулись.
    expect(gridCss).not.toMatch(/\.tab(?:s|Active)? \{/u);
    expect(zoneGrid).not.toMatch(/desire[\s\S]{0,40}(?:header|Header|заголов)/u);
  });
});

describe("мост из зоны в витрину — только хозяйке и только по делу", () => {
  it("строка приходит СНАРУЖИ: сетка сама решать это не имеет права", () => {
    // Гостевая сетка — та же `ZoneGrid`. Единственная защита от «а покажем
    // и гостю» — в том, что узел подаёт вызывающая сторона.
    expect(zoneGrid).toContain("footer?: ReactNode;");
    expect(zoneGrid).not.toContain("inHall");
  });

  it("у хозяйки — есть, и только когда в витрине лежат вещи ЭТОЙ зоны", () => {
    expect(ownerPage).toContain("hallCountsByZone");
    expect(ownerPage).toMatch(/inTreasury > 0 \? \(/u);
    expect(ownerPage).toContain('tHall("zoneBridge", { count: inTreasury })');
    expect(ownerPage).toContain('href="/room/hall"');
  });

  it("у гостя моста НЕТ вовсе", () => {
    expect(guestPage).not.toContain("zoneBridge");
    expect(guestPage).not.toContain("footer=");
  });

  it("счёт витрины по зонам — один запрос и только свои вещи", () => {
    expect(items).toMatch(/export async function hallCountsByZone/u);
    expect(items).toMatch(/by: \["zone"\][\s\S]{0,120}inHall: true/u);
    // Ни одного упоминания броней: число про МЕСТО вещи, а не про то, занята
    // ли она (инвариант №1).
    const body = items.slice(items.indexOf("export async function hallCountsByZone"));
    expect(body.slice(0, 500)).not.toMatch(/booking/iu);
  });

  it("строка тихая и с целью 44 — числа дизайна", () => {
    const globals = read("../src/app/globals.css");
    expect(globals).toMatch(/\.imm-zone-bridge \{[\s\S]*?min-height: 44px;/u);
    expect(globals).toMatch(/\.imm-zone-bridge \{[\s\S]*?opacity: 0\.45;/u);
    expect(task31.treasuryBridge.whenShown).toContain("только хозяйке");
  });
});
