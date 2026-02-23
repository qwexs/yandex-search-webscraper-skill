---
name: web-scraper
description: >
  Token-efficient web scraping via local Ollama model (schematron-3b). Returns compact structured JSON
  (~300-800 tokens) instead of raw page content. PREFER over web_fetch when: extracting structured data
  (title/content/links), scraping multiple pages, monitoring news/blogs, or conserving context tokens.
  Use web_fetch instead when you need full raw text for deep reading or searching specific details.
  Triggers on: "scrape site", "parse page", "extract from url", "read website structure",
  "get news from", "fetch and structure", "parse html into json".
  NOT for: JS-rendered SPAs (React/Vue apps), requires Ollama running locally.
---

# web-scraper

**Token-efficient web scraping через локальный Ollama**

Конвейер: URL → fetch HTML → очистка → Ollama `schematron-3b` → компактный JSON.
В контекст попадает только финальный JSON, не весь HTML.

## web-scraper vs web_fetch

| | **web-scraper** | **web_fetch** |
|---|---|---|
| Токены в контексте | ~300–800 (JSON) | 5k–30k (полный текст) |
| Обработка | Локальная (Ollama) | В контексте агента |
| Результат | Структурированный JSON | Markdown/plain text |
| JS-рендер | ❌ Нет | ❌ Нет |
| Кодировки | ✅ Auto (UTF-8, win-1251) | Зависит от инструмента |

**Когда web-scraper:**
- Новостные/блог сайты с SSR (nvworld.ru, habrahabr, etc.)
- Нужна структура: заголовок, контент, ссылки, изображения
- Массовый обход нескольких URL
- Важно сохранить контекст (длинные сессии)

**Когда web_fetch:**
- Нужен полный текст для детального чтения
- Документация / справочники (нужен конкретный параграф)
- Надо найти точные данные внутри страницы
- Ollama не запущена

## Использование

```bash
# Базовый scraping
bun skills/web-scraper/scripts/scrape.js --url https://nvworld.ru/

# Кастомный prompt для Ollama
bun skills/web-scraper/scripts/scrape.js \
  --url https://blog.com/article \
  --prompt "Extract only title, author, and publish date"

# Compact JSON (без отступов)
bun skills/web-scraper/scripts/scrape.js --url https://news.ycombinator.com --compact
```

## Формат вывода

```json
{
  "title": "Заголовок страницы",
  "description": "Мета-описание или краткое summary",
  "main_content": "Основной текст страницы",
  "links": [{"text": "...", "url": "..."}],
  "images": [{"alt": "...", "src": "..."}],
  "metadata": {"author": "...", "date": "...", "tags": [...]}
}
```

## Скрипты

| Скрипт | Назначение |
|--------|-----------|
| `scrape.js` | Главный entry point (URL → JSON) |
| `fetch-html.js` | Fetch + auto-decode (UTF-8, windows-1251) + очистка HTML |
| `extract.js` | AI extraction через Ollama API |

## Требования

- **Bun** runtime
- **Ollama** запущен: `http://localhost:11434`
- **Модель**: `richardyoung/schematron-3b:Q4_K_M`

```bash
# Установка модели
ollama pull richardyoung/schematron-3b:Q4_K_M
```

## Ограничения

- Только статический HTML (JS-рендер не поддерживается)
- HTML обрезается до 10k символов
- Требует локальный Ollama
