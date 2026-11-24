# OpenCode Entero Assistant

**Applied AI for professional equipment procurement: research, verification and offer ranking.**

> Status: read-only prototype. Automated tests are available; live procurement accuracy, time savings and cost have not yet been established. See [evaluation protocol](docs/EVALUATION.md).

[Русский сценарий работы ниже](#запуск).

Локальный read-only помощник принимает абстрактный запрос на русском языке,
сначала исследует общий интернет, а затем проверяет выбранные модели в каталоге
Entero. Коммерческая часть ответа строится только по подтверждённым страницам
товаров Entero.

## Запуск

Требуется OpenCode 1.18.16 (версия исходного сценария), Node.js 22 для тестов и настроенный провайдер моделей. Проверьте, что модели в `opencode.json` доступны вашему аккаунту; текущий проект и конфигурационные тесты закрепляют конкретный набор моделей. Для другого провайдера нужна отдельная проверенная конфигурация и адаптация тестов. Не храните ключи в репозитории.

```bash
git clone https://github.com/two-potato/opencode-entero-assistant.git
cd opencode-entero-assistant
npm ci --prefix .opencode
npm test
./opencode-entero .
```

Основной агент `search-orchestrator` выбран настройкой `default_agent`.
Проектный wrapper всегда добавляет штатный флаг OpenCode `--pure`. Это сохраняет
локальные agents/tools и отключает глобальные сторонние плагины, которые могут
добавить неразрешённые агенты или изменить маршрутизацию.

Пример запроса:

```text
Нужна кофемашина для небольшой кофейни до 100 тысяч рублей.
```

Одноразовый запуск без TUI:

```bash
./opencode-entero run --agent search-orchestrator "Нужна кофемашина для небольшой кофейни до 100 тысяч рублей."
```

## Последовательность работы

1. `search-orchestrator` нормализует назначение, категорию, бюджет, обязательные
   условия и предпочтения.
2. `internet-researcher` изучает публичный интернет и возвращает основной
   вариант, 3–5 аналогов, критерии выбора и источники.
3. `procurement_validate_research` детерминированно проверяет полноту,
   уникальность и источники исследования.
4. Только после успешной проверки запускается `entero-site-search`. Он ищет
   каждую исследованную модель отдельно и читает товарную страницу каждого
   найденного кандидата.
5. `procurement_rank_offers` отбрасывает неподтверждённые и нарушающие жёсткие
   условия товары, ранжирует доступные выше недоступных и выбирает итоговый
   основной вариант.

`internet-researcher` и `entero-site-search` не запускаются параллельно. Entero
получает полный результат уже завершённого интернет-исследования.

## Итоговый ответ

Помощник показывает:

- один основной вариант с объяснением выбора;
- 3–5 реальных аналогов, если столько найдено на Entero;
- текущую цену, наличие, прямую ссылку и время проверки;
- сходства и значимые отличия аналогов;
- модели, которых нет на Entero;
- причины исключения и дефицит аналогов.

Если исходная основная модель отсутствует или уступает доступному аналогу,
подходящий аналог становится основным вариантом с явным объяснением. Если
реальных аналогов меньше трёх, помощник показывает имеющиеся и сообщает
дефицит — ничего не выдумывает.

Цена, наличие и ссылка подтверждаются только чтением страницы
`https://entero.ru/item/<числовой-id>`. Цена или остаток из общего интернета не
считаются коммерческими данными Entero. Товар со статусом «нет в наличии» может
быть показан с предупреждением и ранжируется ниже доступных.

## Безопасность

Во время подбора разрешены только публичные чтения:

- общий интернет-агент имеет только web search/fetch;
- Entero-агент имеет только три ограниченных `entero_*` инструмента;
- Entero-адаптер допускает только HTTPS `GET` к разрешённым поисковым и
  товарным маршрутам `entero.ru`;
- оркестратор не имеет произвольного браузера, shell или редактирования файлов.

Запрещены логин и пароли, корзина, избранное, быстрый заказ, callback, checkout,
профиль, оформление заказа, внешние редиректы и любые изменяющие запросы.

## Проверка

```bash
npm test
node --check src/request/normalize.mjs
node --check src/entero/policy.mjs
node --check src/entero/parser.mjs
node --check src/entero/client.mjs
node --check src/workflow/contracts.mjs
node --check .opencode/tools/procurement.js
```

Live-проверка использует публичный интернет, Entero и настроенный модельный
провайдер, поэтому её результат зависит от их доступности. Она остаётся
read-only и не должна вызывать элементы покупки или кабинета.

## Engineering overview (EN)

The orchestrator extracts hard requirements, delegates public research, validates sources and candidate uniqueness, then searches the supplier catalog. The ranking step rejects unverifiable offers and mandatory-constraint violations. The assistant does not place orders or modify supplier accounts.

The project is AI-assisted. The meaningful next milestone is a repeatable procurement benchmark against human-reviewed results, not a claim of production readiness.

See [evaluation protocol](docs/EVALUATION.md) for sample tasks, scoring rules, and the roadmap to spreadsheet intake and export.

## Specification intake (offline)

Validate a UTF-8 CSV containing 1–100 equipment requests before any AI execution:

```bash
node src/specification/intake.mjs docs/benchmark-cases.csv
```

The exact header is `case_id,category,request`. The command validates quoting, unique IDs, category, text length and batch limits; any invalid row blocks the entire batch. It outputs normalized JSON without model or supplier calls. The 50 synthetic requests are a candidate benchmark, not measured results. Review them before live evaluation. XLSX, PDF and automatic batch dispatch are not implemented.

## Comparison export (offline)

```bash
node src/specification/export.mjs docs/fixtures/synthetic-ranking-input.json > comparison.csv
```

This operator-only command re-runs the deterministic ranking on an input JSON (`request`, `research`, `candidates`) and exports a UTF-8 BOM CSV suitable for spreadsheet import. It preserves URLs, recorded timestamps, availability, rejected and missing results; formula-like text is escaped. No live verification occurs here. The included fixture is entirely synthetic: its URL, price and timestamp are illustrative, not a commercial offer. Review actual source evidence before using or sending results. No purchase, XLSX/PDF generation or automatic batch dispatch is implemented by this command.

## Native Excel files (offline)

Install Python 3.12+ dependencies in a virtual environment alongside Node.js 22:

```bash
python3 -m venv .venv-xlsx
.venv-xlsx/bin/pip install -r tools/requirements-xlsx.txt
.venv-xlsx/bin/python tools/xlsx_io.py import specification.xlsx
.venv-xlsx/bin/python tools/xlsx_io.py export docs/fixtures/synthetic-ranking-input.json comparison.xlsx
.venv-xlsx/bin/python -m unittest discover -s tools -p 'test_xlsx_io.py' -v
```

Import requires a single visible worksheet with the exact text header `case_id,category,request`, 1–100 rows and no formulas, errors, hyperlinks or extra columns. The same Node CSV validator determines row validity. ZIP and XML input limits apply. Export uses the existing deterministic ranking and creates a new workbook with typed numeric prices, source references and rejection rows; existing files are not overwritten. The example is synthetic, not a commercial offer. No live verification or automatic dispatch is performed.
