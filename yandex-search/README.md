# Yandex Search

Поиск через Yandex Search API. Автоопределение региона по языку запроса (кириллица → RU, латиница → COM).

## Быстрый старт

```bash
# Smart search (рекомендуется)
bun skills/yandex-search/smart-search.js "ваш запрос"
bun skills/yandex-search/smart-search.js "Docker deployment" --limit=5

# Прямой поиск
bun skills/yandex-search/search.js "AMD Zen 6" --limit=5 --format=json

# Поиск + скрапинг контента страниц (через web-scraper)
bun skills/yandex-search/smart-search.js "запрос" --scrape
bun skills/yandex-search/smart-search.js "запрос" --scrape --scrape-top=5
```

## Параметры

### smart-search.js

| Параметр | Описание | По умолчанию |
|---|---|---|
| `--limit=N` | Кол-во результатов | 10 |
| `--format=FORMAT` | `text`, `json`, `markdown` | text |
| `--provider=PROVIDER` | `yandex`, `brave` | yandex |
| `--scrape` | Скрапить контент топ-N страниц | — |
| `--scrape-top=N` | Сколько страниц скрапить | 3 |

### search.js

| Параметр | Описание | По умолчанию |
|---|---|---|
| `--limit=N` | Кол-во результатов | 10 |
| `--format=FORMAT` | `text`, `json`, `markdown` | text |
| `--region=REGION` | `auto`, `ru`, `com`, `tr`, `ua` | auto |
| `--output=FILE` | Сохранить в файл | — |

## Конфигурация

Создайте `skills/yandex-search/config.json`:

```json
{
  "apiKey": "YOUR_API_KEY",
  "folderId": "YOUR_FOLDER_ID"
}
```

Или через переменные окружения:
```bash
export YANDEX_SEARCH_API_KEY="..."
export YANDEX_FOLDER_ID="..."
```

### Получение ключа (Yandex Cloud CLI)

```bash
# Создать сервисный аккаунт
yc iam service-account create --name search-bot

# Назначить роль
yc resource-manager folder add-access-binding $(yc config get folder-id) \
  --role search-api.webSearch.user \
  --service-account-name search-bot

# Создать API ключ
yc iam api-key create --service-account-name search-bot
```

## Форматы вывода

**JSON:**
```json
{
  "query": "AMD Zen 6",
  "found": 2485788,
  "results": [
    {
      "title": "Zen 6 - Wikipedia",
      "url": "https://en.wikipedia.org/wiki/Zen_6",
      "snippet": "Zen 6 is the name for an upcoming CPU microarchitecture...",
      "domain": "en.wikipedia.org"
    }
  ]
}
```

**JSON с `--scrape`** (добавляет полный контент страниц):
```json
{
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "scraped_content": "# Заголовок\n\nПолный текст статьи в Markdown..."
    }
  ]
}
```

## Troubleshooting

**"Unknown api key"** — заголовок должен быть `Authorization: Api-Key`, не `Bearer`

**"Permission denied":**
```bash
yc resource-manager folder add-access-binding <FOLDER_ID> \
  --role search-api.webSearch.user --service-account-name search-bot
```

**Пустые результаты** — проверь `folderId` и формат `searchType` (`SEARCH_TYPE_RU`, не `RU`)
