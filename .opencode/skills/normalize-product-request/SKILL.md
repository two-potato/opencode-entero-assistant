---
name: normalize-product-request
description: Use when a Russian product-selection request is abstract, colloquial, budget-constrained, or mixes hard requirements with preferences.
---

# Нормализация запроса товара

## Контракт результата

```json
{
  "raw_request": "исходный текст",
  "product_type": "основная категория товара",
  "intended_use": "сценарий использования или null",
  "budget": {"min": null, "max": 20000, "currency": "RUB"},
  "hard_constraints": ["обязательные свойства"],
  "preferences": ["желательные свойства"],
  "excluded": ["что не подходит"],
  "site_id": "entero",
  "analog_count": {"min": 3, "max": 5},
  "clarification_required": false,
  "clarification_question": null
}
```

## Правила

- Преобразуй `20 тысяч`, `20 тыс`, `20к`, `20 кэсов` в `20000`.
- Считай `до X` и `за X` жёстким `budget.max`; диапазон `от X до Y` запиши в обе границы.
- Используй `RUB`, если пользователь явно не задал другую валюту. Не угадывай курс.
- Сохраняй обязательное в `hard_constraints`, пожелания в `preferences`, отрицания в `excluded`.
- Для MVP всегда ставь `site_id: "entero"` и `analog_count: {"min": 3, "max": 5}`. Минимум аналогов задаёт цель, но не разрешает выдумывать отсутствующие товары.
- Не придумывай категорию, назначение или характеристики.
- Ставь `clarification_required: true` только когда неоднозначность категории, валюты или жёсткого условия приведёт к существенно другому поиску. Задавай один разделяющий вопрос.

## Быстрая проверка

| Фраза | Нормализация |
|---|---|
| `телефон за 20 кэсов` | `product_type=телефон`, `budget.max=20000` |
| `кофемашина от 30 до 50 тысяч` | `budget.min=30000`, `budget.max=50000` |
| `миксер, желательно тихий` | `hard_constraints=[]`, `preferences=[тихий]` |

Не смешивай аксессуар с основным товаром и не смягчай жёсткий бюджет.
