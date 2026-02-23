#!/usr/bin/env bun

/**
 * fetch-html.js
 * Fetches HTML from URL and cleans it for LLM processing
 * Usage: bun scripts/fetch-html.js <url>
 */

const MAX_LENGTH = 10000;
const TIMEOUT_MS = 30000;

// Атрибуты которые оставляем
const KEEP_ATTRS = ['href', 'src', 'alt', 'title', 'aria-label'];

function showUsage() {
  console.error('Usage: bun scripts/fetch-html.js <url>');
  console.error('Example: bun scripts/fetch-html.js https://example.com');
  process.exit(1);
}

// Селекторы главного контента — от наиболее специфичных к общим
const CONTENT_SELECTORS = [
  // Явные контентные зоны
  'article',
  'main',
  '[role="main"]',
  // Популярные CMS / движки
  '#mw-content-text',      // Wikipedia
  '.mw-parser-output',     // Wikipedia
  '#bodyContent',          // Wikipedia fallback
  '.post-content',
  '.entry-content',
  '.article-content',
  '.article-body',
  '.content-body',
  '.news-text',
  '.text-content',
  '#content',
  '.content',
];

/**
 * Пытается вырезать главный контентный блок из HTML
 * Возвращает innerHTML блока или null
 */
function extractMainBlock(html) {
  for (const selector of CONTENT_SELECTORS) {
    let pattern;
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      pattern = new RegExp(`<[a-z][a-z0-9]*\\s[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
    } else if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      pattern = new RegExp(`<[a-z][a-z0-9]*\\s[^>]*\\bclass=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]{200,})`, 'i');
    } else if (selector.startsWith('[role=')) {
      pattern = new RegExp(`<[a-z][a-z0-9]*\\s[^>]*\\brole=["']main["'][^>]*>([\\s\\S]{200,})`, 'i');
    } else {
      // tag selector
      pattern = new RegExp(`<${selector}[^>]*>([\\s\\S]{200,})<\\/${selector}>`, 'i');
    }
    const m = html.match(pattern);
    if (m && m[1] && m[1].length > 200) {
      return m[1];
    }
  }
  return null;
}

function cleanHTML(html) {
  // Убираем скрипты, стили, SVG, noscript
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  html = html.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
  html = html.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  
  // Убираем HTML комментарии
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Пытаемся вычленить основной контентный блок
  const mainBlock = extractMainBlock(html);
  if (mainBlock) {
    html = mainBlock;
  }

  // Убираем лишние атрибуты (оставляем только KEEP_ATTRS)
  html = html.replace(/<([a-z][a-z0-9]*)\s+([^>]*)>/gi, (match, tag, attrs) => {
    const cleanedAttrs = attrs
      .split(/\s+(?=[a-z-]+=)/i)
      .filter(attr => {
        const attrName = attr.split('=')[0].toLowerCase();
        return KEEP_ATTRS.includes(attrName);
      })
      .join(' ');
    
    return cleanedAttrs ? `<${tag} ${cleanedAttrs}>` : `<${tag}>`;
  });
  
  // Нормализуем пробелы
  html = html.replace(/\s+/g, ' ');
  html = html.replace(/>\s+</g, '><');
  
  return html.trim();
}

/**
 * Определяет кодировку из Content-Type заголовка или <meta charset> в HTML
 */
function detectCharset(contentType, buffer) {
  // 1. Из Content-Type header: charset=windows-1251
  const ctMatch = contentType.match(/charset=([^\s;]+)/i);
  if (ctMatch) {
    const cs = ctMatch[1].toLowerCase().replace(/['"]/g, '');
    try { new TextDecoder(cs); return cs; } catch {}
  }

  // 2. Из первых 2048 байт HTML: <meta charset="..."> или <meta http-equiv="content-type" content="...charset=...">
  const peek = new TextDecoder('latin1').decode(buffer.slice(0, 2048));
  const metaMatch =
    peek.match(/<meta[^>]+charset=["']?([^"'\s;>]+)/i) ||
    peek.match(/<meta[^>]+content=["'][^"']*charset=([^"'\s;>]+)/i);
  if (metaMatch) {
    const cs = metaMatch[1].toLowerCase().replace(/['"]/g, '');
    try { new TextDecoder(cs); return cs; } catch {}
  }

  return 'utf-8';
}

async function fetchHTML(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Not HTML content: ${contentType}`);
    }

    // Читаем как бинарник, определяем кодировку
    const buffer = await response.arrayBuffer();
    const charset = detectCharset(contentType, buffer);
    const html = new TextDecoder(charset).decode(buffer);
    return html;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error(`Timeout after ${TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
  }
  
  const url = args[0];
  
  // Валидация URL
  try {
    new URL(url);
  } catch {
    console.error(`Error: Invalid URL: ${url}`);
    process.exit(1);
  }
  
  try {
    const html = await fetchHTML(url);
    let cleaned = cleanHTML(html);
    
    // Обрезаем если слишком длинный
    if (cleaned.length > MAX_LENGTH) {
      cleaned = cleaned.substring(0, MAX_LENGTH) + '...';
    }
    
    console.log(cleaned);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
