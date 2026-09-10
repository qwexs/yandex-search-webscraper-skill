#!/usr/bin/env bun

/**
 * scrape.js
 * Main entry point: URL → clean Markdown
 * Usage: bun scripts/scrape.js --url <url> [--prompt "custom"] [--retry]
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
  console.error('  --prompt <text>      Custom HTML-to-Markdown prompt (optional)');
  console.error('  --retry              Retry once on failure (default: enabled)');
  console.error('  --no-retry           Disable retry on failure');
  console.error('  --help, -h           Show this help');
  console.error('');
  console.error('Examples:');
  console.error('  bun scripts/scrape.js --url https://example.com');
  console.error('  bun scripts/scrape.js --url https://news.ycombinator.com');
  console.error('  bun scripts/scrape.js --url https://blog.com/post --prompt "Keep title and article body"');
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    url: null,
    prompt: null,
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

async function scrapeWithRetry(url, prompt, retryEnabled) {
  const fetchScript = resolve(__dirname, 'fetch-html.js');
  const extractScript = resolve(__dirname, 'extract.js');
  
  let lastError = null;
  const maxAttempts = retryEnabled ? MAX_RETRIES + 1 : 1;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Шаг 1: Fetch HTML
      const html = await runScript(fetchScript, [url]);
      
      // Шаг 2: Convert HTML to Markdown with ReaderLM-v2
      const extractArgs = prompt ? ['--prompt', prompt] : [];
      const markdown = await runScript(extractScript, extractArgs, html);
      
      return markdown;
      
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
  
  try {
    const markdown = await scrapeWithRetry(config.url, config.prompt, config.retry);
    process.stdout.write(markdown.endsWith('\n') ? markdown : markdown + '\n');
    
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    
    process.exit(1);
  }
}

main();
