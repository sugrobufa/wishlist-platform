import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BAR = readFileSync(resolve(process.cwd(), "src/app/r/[slug]/guest-bar.tsx"), "utf8");
const PAGE = readFileSync(resolve(process.cwd(), "src/app/r/[slug]/page.tsx"), "utf8");

/**
 * 247 — ПРИЗЫВ «СОБРАТЬ СВОЮ» ДОСТИЖИМ.
 *
 * Приёмка 14.08.2026: «у гостя совсем не видно призыв создать свою комнату,
 * просто не дойти до этой кнопки». Он стоял строкой ПОД списком зон, и дизайн
 * подтвердил, что место неверное: «строка в потоке недостижима не случайно —
 * она ниже списка зон, а список растёт с числом полок» (турн 56b, пакет 55).
 */
describe("247 — гостевой бар", () => {
  it("призыва в потоке под списком зон больше нет", () => {
    // Если строка вернётся — вернётся и жалоба: она недостижима по построению.
    expect(PAGE).not.toContain('{t("ctaHint")}');
    expect(PAGE).not.toMatch(/<Link\s+href="\/"[\s\S]{0,160}\{t\("cta"\)\}/u);
  });

  it("призыв стоит третьим местом бара со знаком плюс", () => {
    expect(BAR).toContain('tGuest("cta")');
    expect(BAR).toContain("<IconPlus size={22}");
    // `ctaHint` в бар не едет — там место названию (турн 61d). Проверяем
    // ВЫЗОВ, а не слово: в шапке файла оно стоит в разборе, и запрет на слово
    // запрещал бы объяснять решение.
    expect(BAR).not.toMatch(/t\w*\("ctaHint"\)/u);
  });

  it("«Добавить» у гостя нет — в чужую комнату вещь не положишь", () => {
    expect(BAR).not.toContain("ADD_HREF");
    expect(BAR).not.toMatch(/tabs["']?\s*\)/u);
  });

  it("витрина в баре только когда она открыта", () => {
    expect(BAR).toContain("hallHref !== null");
    expect(PAGE).toContain('hallHref={hasHall && room.hallVisibility !== "NONE" ? hallHref : null}');
  });

  it("МЕСТО ПОД БАР ВОЗВРАЩЕНО РАСКЛАДКЕ: своего --imm-bar-h у гостя больше нет", () => {
    // Пока бара не было, гостевая страница объявляла «бара нет» и забирала
    // нижние 86 px себе. Теперь там стоят три места, и полоса обязана встать
    // НАД баром — иначе список зон уедет под него, и одна жалоба сменится
    // другой. Инсет второй раз не прибавляется: он уже внутри --imm-tab-bar.
    expect(PAGE).not.toContain('"--imm-bar-h"');
  });

  it("бар берёт стили общей полосы, а не заводит свои числа", () => {
    expect(BAR).toContain('from "@/components/tab-bar/tab-bar.module.css"');
  });
});
