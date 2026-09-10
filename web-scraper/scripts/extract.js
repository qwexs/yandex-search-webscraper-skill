#!/usr/bin/env bun

/**
 * Converts cleaned HTML to Markdown using ReaderLM-v2 through Ollama.
 * Usage: bun scripts/extract.js [--prompt "custom prompt"] < input.html
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.OLLAMA_MODEL || 'Whyimhere/ReaderLM-v2:latest';
const TIMEOUT_MS = 60000;

const DEFAULT_PROMPT = `Convert the following HTML to clean, information-dense Markdown.
Keep the page title, headings, paragraphs, lists, tables, code, and useful links.
Remove navigation, advertisements, cookie banners, footers, and other boilerplate.
Preserve facts and wording from the source. Do not summarize, explain, or invent content.
Return only Markdown.`;

function showUsage() {
  console.error('Usage: bun scripts/extract.js [--prompt "custom prompt"] < input.html');
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function callOllama(html, prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: `${prompt}\n\nHTML:\n${html}`,
        stream: false,
        options: { temperature: 0 }
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama API error ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    return data.response;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Ollama timeout after ${TIMEOUT_MS}ms`);
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to Ollama. Is it running? (http://localhost:11434)');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cleanMarkdown(text) {
  return text.trim()
    .replace(/^```(?:markdown|md)?\s*\n/i, '')
    .replace(/\n```\s*$/i, '')
    .trim();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) showUsage();

  const promptIndex = args.indexOf('--prompt');
  const customPrompt = promptIndex !== -1 ? args[promptIndex + 1] : null;

  try {
    const html = await readStdin();
    if (!html.trim()) throw new Error('No input HTML received from stdin');

    const markdown = cleanMarkdown(await callOllama(html, customPrompt || DEFAULT_PROMPT));
    if (!markdown) throw new Error('ReaderLM-v2 returned empty content');
    process.stdout.write(markdown + '\n');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
