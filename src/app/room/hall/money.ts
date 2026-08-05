// Показ денег в зале славы (тикет 35). Деньги живут Decimal-строкой до самого
// последнего момента: Number здесь — только чтобы Intl расставил разряды и
// знак валюты, никакой арифметики над этим числом не делается (арифметика —
// в dto/hall.ts на Decimal). Тот же приём, что в плитке зоны (ItemTile).

/** «62 000 ₽». Неизвестный код валюты не роняет страницу — покажем как есть. */
export function formatHallMoney(
  amount: string,
  currency: string | null,
  locale: string,
): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency ?? ""}`.trim();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency ?? "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}
