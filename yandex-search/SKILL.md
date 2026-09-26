---
name: yandex-search
description: Search the web using Yandex Search API. Supports all languages with automatic region detection. Returns titles, URLs, and text snippets. Default provider for all web searches.
---

# Yandex Search API Skill

Универсальный поиск в интернете через Yandex Search API. Поддерживает все языки с автоматическим определением региона (RU для кириллицы, COM для латиницы).

## Использование

```bash
# Поиск на любом языке через Yandex (автоопределение региона)
bun skills/yandex-search/smart-search.js "ваш запрос"

# Кириллица → Yandex (российский поиск)
bun skills/yandex-search/smart-search.js "PostgreSQL индексы" --limit=5

# Латиница → Yandex (международный поиск)
bun skills/yandex-search/smart-search.js "PostgreSQL indexes" --limit=5

# Принудительно использовать Brave (если нужно)
bun skills/yandex-search/smart-search.js "query" --provider=brave

# Поиск + скрапинг топ-3 страниц (полный контент через web-scraper)
bun skills/yandex-search/smart-search.js "NVIDIA RTX 5090" --scrape

# Скрапинг топ-5 страниц
bun skills/yandex-search/smart-search.js "AMD Zen 6" --scrape --scrape-top=5
```

> **`--scrape`** — после поиска берёт топ-N URL и прогоняет каждый через Scrapling (`HTTP → JS browser → stealth`).
> Результат: JSON с дополнительным полем `scraped_content` (чистый Markdown).
> LLM не используется. Для JS/stealth режимов требуются браузеры из `scrapling install`.

### Yandex Search напрямую

```bash
# Простой поиск
bun skills/yandex-search/search.js "ваш запрос"

# С ограничением результатов
bun skills/yandex-search/search.js "запрос" --limit=5

# Только с определённого региона
bun skills/yandex-search/search.js "запрос" --region=ru

# Сохранить результаты в файл
bun skills/yandex-search/search.js "запрос" --output=results.json
```

## Параметры

- **query** (обязательно) — текст поискового запроса
- **--limit N** — количество результатов (по умолчанию: 10, макс: 100)
- **--region REGION** — регион поиска: `ru` (Россия), `com` (международный), `tr` (Турция), `ua` (Украина)
- **--output FILE** — сохранить результаты в JSON файл
- **--format FORMAT** — формат вывода: `json`, `text`, `markdown` (по умолчанию: text)
- **--scrape** — дополнительно скрапить страницы через web-scraper (полный контент)
- **--scrape-top N** — сколько страниц скрапить (по умолчанию: 3)
- **--scrape-mode MODE** — `auto`, `http`, `dynamic`, `stealth` (по умолчанию: `auto`)
- **--scrape-concurrency N** — число параллельных страниц (по умолчанию: 2)

## Настройка

Создайте файл `skills/yandex-search/config.json`:

```json
{
  "apiKey": "YOUR_YANDEX_SEARCH_API_KEY",
  "folderId": "YOUR_YANDEX_FOLDER_ID",
  "region": "225",
  "language": "ru"
}
```

Или используйте переменные окружения:

```bash
export YANDEX_SEARCH_API_KEY="YOUR_API_KEY"
export YANDEX_FOLDER_ID="YOUR_FOLDER_ID"
```

## Формат вывода

**Text (по умолчанию):**
```
1. Title of the page
   https://example.com/page
   Snippet with highlighted keywords...
```

**JSON:**
```json
{
  "query": "claude-flow SWE-bench",
  "found": 54243,
  "results": [
    {
      "title": "Performance Benchmarking · ruvnet/claude-flow Wiki",
      "url": "https://github.com/ruvnet/claude-flow/wiki/Performance-Benchmarking",
      "snippet": "Claude-flow includes comprehensive benchmarking capabilities...",
      "domain": "github.com"
    }
  ]
}
```

**Markdown:**
```markdown
# Search Results: "claude-flow SWE-bench"
Found: 54,243 results

## 1. Performance Benchmarking · ruvnet/claude-flow Wiki
**URL:** https://github.com/ruvnet/claude-flow/wiki/Performance-Benchmarking
**Domain:** github.com

Claude-flow includes comprehensive benchmarking capabilities...
```

## Преимущества перед Brave Search

1. **Локализация** — лучше понимает русскоязычные запросы
2. **Региональная выдача** — приоритет контенту из России/СНГ
3. **Интеграция с Yandex Cloud** — единая платформа (у нас уже есть apriori-vm)
4. **Цены в рублях** — проще планировать бюджет

## Примеры

```bash
# Поиск технической документации
bun skills/yandex-search/search.js "PostgreSQL индексы BRIN" --limit=5

# Поиск новостей
bun skills/yandex-search/search.js "Anthropic Claude 4.5" --region=ru

# Поиск с сохранением
bun skills/yandex-search/search.js "Yandex Cloud API" --output=yc-docs.json --format=json
```

## Ограничения

- Максимум 100 результатов за запрос
- XML ответ требует парсинга
- Стоимость по тарифам Yandex Cloud

## Troubleshooting

**`Bun is not defined`:**
- Скрипт был запущен через `node`; повторите команду через `bun`
- Проверьте установку командой `bun --version`

**"Unknown api key":**
- Проверьте, что используется `Authorization: Api-Key`, а не `Bearer`
- Убедитесь, что у сервисного аккаунта есть роль `search-api.webSearch.user`

**"Permission denied":**
```bash
yc resource-manager folder add-access-binding <folder-id> \
  --role search-api.webSearch.user \
  --service-account-name ai
```

**Пустые результаты:**
- Проверьте формат `searchType`: должно быть `SEARCH_TYPE_RU`, а не просто `RU`
- Убедитесь, что folderId правильный

## Интеграция с OpenClaw

Этот скилл можно вызывать через `exec` tool или добавить в существующий web_search tool как альтернативный провайдер.

## Ссылки

- [Официальная документация](https://yandex.cloud/ru/docs/search-api/)
- [REST API Reference](https://yandex.cloud/ru/docs/search-api/api-ref/)
- [Примеры использования](https://yandex.cloud/ru/docs/search-api/operations/)
