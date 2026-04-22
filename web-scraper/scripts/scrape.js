#!/usr/bin/env bun

/**
 * scrape.js
 * Main entry point: URL → Structured JSON
 * Usage: bun scripts/scrape.js --url <url> [--prompt "custom"] [--compact] [--retry]
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 1;

function showUsage() {
  console.error('Usage: bun scripts/scrape.js --url <url> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --url <url>          Target URL to scrape (required)');
  console.error('  --prompt <text>      Custom extraction prompt (optional)');
  console.error('  --extractor <type>   Extraction backend: ollama (default) or tavily');
  console.error('  --compact            Output compact JSON instead of pretty-print');
  console.error('  --retry              Retry once on failure (default: enabled)');
  console.error('  --no-retry           Disable retry on failure');
  console.error('  --help, -h           Show this help');
  console.error('');
  console.error('Examples:');
  console.error('  bun scripts/scrape.js --url https://example.com');
  console.error('  bun scripts/scrape.js --url https://news.ycombinator.com --compact');
  console.error('  bun scripts/scrape.js --url https://blog.com/post --prompt "Extract only title and author"');
  console.error('  bun scripts/scrape.js --url https://example.com --extractor tavily');
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    url: null,
    prompt: null,
    extractor: 'ollama',
    compact: false,
    retry: true
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        parsed.url = args[++i];
        break;
      case '--prompt':
        parsed.prompt = args[++i];
        break;
      case '--extractor':
        parsed.extractor = args[++i];
        break;
      case '--compact':
        parsed.compact = true;
        break;
      case '--retry':
        parsed.retry = true;
        break;
      case '--no-retry':
        parsed.retry = false;
        break;
      case '--help':
      case '-h':
        showUsage();
        break;
    }
  }
  
  return parsed;
}

function runScript(scriptPath, args = [], input = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', [scriptPath, ...args], {
      cwd: dirname(scriptPath),
      timeout: TIMEOUT_MS
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('error', (error) => {
      reject(new Error(`Failed to run ${scriptPath}: ${error.message}`));
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Script exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });
    
    // Если есть input, отправляем в stdin
    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

async function scrapeWithTavily(url, prompt) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable is required when using --extractor tavily');
  }

  const body = {
    urls: [url],
    extract_depth: "basic",
    include_images: true
  };
  if (prompt) {
    body.query = prompt;
    body.chunks_per_source = 3;
  }

  const response = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily Extract API error (${response.status}): ${text}`);
  }

  const data = await response.json();

  if (data.failed_results && data.failed_results.length > 0) {
    const fail = data.failed_results[0];
    throw new Error(`Tavily extraction failed for ${fail.url}: ${fail.error}`);
  }

  if (!data.results || data.results.length === 0) {
    throw new Error('Tavily Extract returned no results');
  }

  const result = data.results[0];
  const content = result.raw_content || '';

  // Map Tavily response to the same schema as the Ollama path
  const lines = content.split('\n').filter(l => l.trim());
  const title = lines[0] || '';

  const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const links = [];
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }

  const images = (result.images || []).map(src => ({ alt: '', src }));

  return JSON.stringify({
    title,
    description: '',
    main_content: content,
    links,
    images,
    metadata: { source: 'tavily-extract', url: result.url }
  }, null, 2);
}

async function scrapeWithRetry(url, prompt, retryEnabled) {
  const fetchScript = resolve(__dirname, 'fetch-html.js');
  const extractScript = resolve(__dirname, 'extract.js');
  
  let lastError = null;
  const maxAttempts = retryEnabled ? MAX_RETRIES + 1 : 1;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Шаг 1: Fetch HTML
      const html = await runScript(fetchScript, [url]);
      
      // Шаг 2: Extract JSON
      const extractArgs = prompt ? ['--prompt', prompt] : [];
      const json = await runScript(extractScript, extractArgs, html);
      
      return json;
      
    } catch (error) {
      lastError = error;
      
      if (attempt < maxAttempts) {
        console.error(`Attempt ${attempt} failed: ${error.message}`, '\n');
        console.error(`Retrying (${attempt + 1}/${maxAttempts})...`, '\n');
        // Небольшая задержка перед retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  throw lastError;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showUsage();
  }
  
  const config = parseArgs(args);
  
  if (!config.url) {
    console.error('Error: --url is required\n');
    showUsage();
  }

  if (config.extractor !== 'ollama' && config.extractor !== 'tavily') {
    console.error(`Error: --extractor must be "ollama" or "tavily", got "${config.extractor}"\n`);
    showUsage();
  }

  try {
    const jsonOutput = config.extractor === 'tavily'
      ? await scrapeWithTavily(config.url, config.prompt)
      : await scrapeWithRetry(config.url, config.prompt, config.retry);
    
    // Форматируем вывод
    if (config.compact) {
      const parsed = JSON.parse(jsonOutput);
      console.log(JSON.stringify(parsed));
    } else {
      console.log(jsonOutput);
    }
    
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    
    // Возвращаем пустой JSON при ошибке
    const errorJson = {
      title: "",
      description: "",
      main_content: "",
      links: [],
      images: [],
      metadata: {},
      error: error.message
    };
    
    console.log(JSON.stringify(errorJson, null, config.compact ? 0 : 2));
    process.exit(1);
  }
}

main();
