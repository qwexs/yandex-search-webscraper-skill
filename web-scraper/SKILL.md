---
name: web-scraper
description: >
  Token-efficient web scraping via local Ollama model (ReaderLM-v2). Returns clean Markdown
  instead of raw HTML. PREFER over web_fetch when: reading articles, scraping multiple pages,
  monitoring news/blogs, or removing page boilerplate before analysis.
  Use web_fetch instead when you need full raw text for deep reading or searching specific details.
  Triggers on: "scrape site", "parse page", "extract from url", "read website structure",
  "get news from", "fetch and clean", "convert html to markdown".
  NOT for: JS-rendered SPAs (React/Vue apps), requires Ollama running locally.
---

# web-scraper

**Token-efficient web scraping через локальный Ollama**

Конвейер: URL → fetch HTML → очистка → Ollama `ReaderLM-v2` → чистый Markdown.
В контекст попадает только очищенный контент, не весь HTML.

## web-scraper vs web_fetch

| | **web-scraper** | **web_fetch** |
|---|---|---|
| Токены в контексте | Только основной контент | 5k–30k (полный текст) |
| Обработка | Локальная (Ollama) | В контексте агента |
| Результат | Очищенный Markdown | Markdown/plain text |
| JS-рендер | ❌ Нет | ❌ Нет |
| Кодировки | ✅ Auto (UTF-8, win-1251) | Зависит от инструмента |

**Когда web-scraper:**
- Новостные/блог сайты с SSR (nvworld.ru, habrahabr, etc.)
- Нужен читаемый контент без навигации, рекламы и boilerplate
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

# Кастомный prompt для ReaderLM-v2
bun skills/web-scraper/scripts/scrape.js \
  --url https://blog.com/article \
  --prompt "Convert the article to Markdown and keep title, author, and date"

```

## Скрипты

| Скрипт | Назначение |
|--------|-----------|
| `scrape.js` | Главный entry point (URL → Markdown) |
| `fetch-html.js` | Fetch + auto-decode (UTF-8, windows-1251) + очистка HTML |
| `extract.js` | HTML → Markdown через ReaderLM-v2 и Ollama API |

## Требования

- **Bun** runtime
- **Ollama** запущен: `http://localhost:11434`
- **Модель**: `Whyimhere/ReaderLM-v2:latest`

```bash
# Установка модели
ollama pull Whyimhere/ReaderLM-v2
```

## Ограничения

- Только статический HTML (JS-рендер не поддерживается)
- HTML обрезается до 10k символов
- Требует локальный Ollama
