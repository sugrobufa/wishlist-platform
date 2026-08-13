# CHANGES · round49

## Снято

- **`states.OPEN.loud`** целиком (ключа `Occasion.thanksAll` не существовало,
  и кнопки быть не должно). `buttonLife` был прав, `states` — нет.
- **`Occasion.aheadNoLoud`** — объясняла хозяйке проектное решение.
- **`hitTarget`: «полоса целиком»** из `desire-scale.json` — четыре цели 44.
- **Мета-строка «цена · огоньки · слово»** из турна 54c — держалась на точке 5.
- **Числа шкалы 6/5** (round41) и **5/4** (round48) — оба снимаю.
- **Просьба круглить знак витрины** из `photo-signs.json` — довод был выдуман.

## Добавлено

- **`Occasion.thanksGuest`** = «Сказать спасибо» — адресная благодарность.
- **`ItemCard._geometry`** — одно число шкалы и почему оно из round29.
- **`Pool._gender`, `Pool._youPlural`** — правило и список трёх ключей.
- **Правило формы знаков**: метка принадлежит месту → квадрат; кнопка
  принадлежит руке → круг. Проверка: по знаку можно тапнуть отдельно?

## Переименовано в словаре

`pool` → `PoolInline` · `zoneCounterGuest` → `ZoneCounterGuest` ·
`phoneFieldRemoved` → `_phoneFieldRemoved`.

## Переписано без рода — 8 строк Pool

`organizerLine` · `handedOver` · `notHandedYet` · `markHandedOver` ·
`markBoughtWhoCan` · `failedMoney` · `leaveHandedTitle` · `leaveHandedLine`.
Ни одной пары ключей на два рода не заведено.
