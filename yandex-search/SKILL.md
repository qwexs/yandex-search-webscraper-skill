---
name: yandex-search
description: Search the web using Yandex Search API. Supports all languages with automatic region detection. Returns titles, URLs, and text snippets. Default provider for all web searches.
---

# Yandex Search API Skill

Универсальный поиск в интернете через Yandex Search API. Поддерживает все языки с автоматическим определением региона (RU для кириллицы, COM для латиницы).

## Использование

### Smart Search (всегда через Yandex)

```bash
# Поиск на любом языке через Yandex (автоопределение региона)
node skills/yandex-search/smart-search.js "ваш запрос"

# Кириллица → Yandex (российский поиск)
node skills/yandex-search/smart-search.js "PostgreSQL индексы" --limit=5

# Латиница → Yandex (международный поиск)
node skills/yandex-search/smart-search.js "PostgreSQL indexes" --limit=5

# Принудительно использовать Brave (если нужно)
node skills/yandex-search/smart-search.js "query" --provider=brave

# Использовать Tavily Search API
node skills/yandex-search/smart-search.js "query" --provider=tavily

# Поиск + скрапинг топ-3 страниц (полный контент через web-scraper)
node skills/yandex-search/smart-search.js "NVIDIA RTX 5090" --scrape

# Скрапинг топ-5 страниц
node skills/yandex-search/smart-search.js "AMD Zen 6" --scrape --scrape-top=5
```

> **`--scrape`** — после поиска берёт топ-N URL и прогоняет каждый через `web-scraper` (Ollama local).
> Результат: JSON с дополнительными полями `scraped_content`, `scraped_title`, `scraped_description`.
> Требует запущенный Ollama с моделью `richardyoung/schematron-3b:Q4_K_M`.

### Yandex Search напрямую

```bash
# Простой поиск
node skills/yandex-search/search.js "ваш запрос"

# С ограничением результатов
node skills/yandex-search/search.js "запрос" --limit=5

# Только с определённого региона
node skills/yandex-search/search.js "запрос" --region=ru

# Сохранить результаты в файл
node skills/yandex-search/search.js "запрос" --output=results.json
```

## Параметры

- **query** (обязательно) — текст поискового запроса
- **--limit N** — количество результатов (по умолчанию: 10, макс: 100)
- **--region REGION** — регион поиска: `ru` (Россия), `com` (международный), `tr` (Турция), `ua` (Украина)
- **--output FILE** — сохранить результаты в JSON файл
- **--format FORMAT** — формат вывода: `json`, `text`, `markdown` (по умолчанию: text)
- **--scrape** — дополнительно скрапить страницы через web-scraper (полный контент)
- **--scrape-top N** — сколько страниц скрапить (по умолчанию: 3)

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

### Tavily Search (--provider=tavily)

Для использования Tavily Search API установите переменную окружения:

```bash
export TAVILY_API_KEY="YOUR_TAVILY_API_KEY"
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
node skills/yandex-search/search.js "PostgreSQL индексы BRIN" --limit 5

# Поиск новостей
node skills/yandex-search/search.js "Anthropic Claude 4.5" --region ru

# Поиск с сохранением
node skills/yandex-search/search.js "Yandex Cloud API" --output yc-docs.json --format json
```

## Ограничения

- Максимум 100 результатов за запрос
- XML ответ требует парсинга
- Стоимость по тарифам Yandex Cloud

## Troubleshooting

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
