#!/usr/bin/env bun

/**
 * extract.js
 * Extracts structured JSON from HTML using Ollama
 * Usage: bun scripts/extract.js [--prompt "custom prompt"] < input.html
 */

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'richardyoung/schematron-3b:Q4_K_M';
const TIMEOUT_MS = 60000;

const DEFAULT_PROMPT = `Extract the main content from this HTML and return ONLY valid JSON with this structure:
{
  "title": "page title",
  "description": "brief description",
  "main_content": "main text content",
  "links": [{"text": "...", "url": "..."}],
  "images": [{"alt": "...", "src": "..."}],
  "metadata": {"author": "...", "date": "...", "tags": [...]}
}

Do not include any explanations, markdown formatting, or extra text. Return only the JSON object.`;

function showUsage() {
  console.error('Usage: bun scripts/extract.js [--prompt "custom prompt"] < input.html');
  console.error('Example: echo "<html>...</html>" | bun scripts/extract.js');
  console.error('Example: bun scripts/extract.js --prompt "Extract only links" < page.html');
  process.exit(1);
}

async function readStdin() {
  const decoder = new TextDecoder();
  const chunks = [];
  
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  
  const buffer = Buffer.concat(chunks);
  return decoder.decode(buffer);
}

async function callOllama(html, prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: `${prompt}\n\nHTML:\n${html}`,
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.9
        }
      })
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${text}`);
    }
    
    const data = await response.json();
    return data.response;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error(`Ollama timeout after ${TIMEOUT_MS}ms`);
    }
    
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to Ollama. Is it running? (http://localhost:11434)');
    }
    
    throw error;
  }
}

function extractJSON(text) {
  // Пытаемся найти JSON в тексте (модель может добавить markdown или текст)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in model response');
  }
  
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error(`Invalid JSON in response: ${error.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showUsage();
  }
  
  // Парсим аргументы
  let customPrompt = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' && args[i + 1]) {
      customPrompt = args[i + 1];
      break;
    }
  }
  
  const prompt = customPrompt || DEFAULT_PROMPT;
  
  try {
    // Читаем HTML из stdin
    const html = await readStdin();
    
    if (!html.trim()) {
      throw new Error('No input HTML received from stdin');
    }
    
    // Вызываем Ollama
    const modelResponse = await callOllama(html, prompt);
    
    // Извлекаем и валидируем JSON
    const jsonData = extractJSON(modelResponse);
    
    // Выводим pretty JSON
    console.log(JSON.stringify(jsonData, null, 2));
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    // Возвращаем пустой но валидный JSON при ошибке
    console.log(JSON.stringify({
      title: "",
      description: "",
      main_content: "",
      links: [],
      images: [],
      metadata: {},
      error: error.message
    }, null, 2));
    
    process.exit(1);
  }
}

main();
