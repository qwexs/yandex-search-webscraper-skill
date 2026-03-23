#!/usr/bin/env bun
// @ts-check

/**
 * Smart Web Search - Automatically chooses between Yandex and Brave Search
 * based on query language
 * 
 * Usage: bun smart-search.js "query" [--limit N] [--provider yandex|brave|tavily|auto] [--format json|text|markdown]
 */

// Parse arguments
const args = process.argv.slice(2);
const query = args.find(arg => !arg.startsWith('--'));
const limit = parseInt(args.find(arg => arg.startsWith('--limit'))?.split('=')[1] || '10');
const provider = args.find(arg => arg.startsWith('--provider'))?.split('=')[1] || 'auto';
const format = args.find(arg => arg.startsWith('--format'))?.split('=')[1] || 'text';
const scrape = args.includes('--scrape');
const scrapeTop = parseInt(args.find(arg => arg.startsWith('--scrape-top'))?.split('=')[1] || '3');

if (!query) {
  console.error('Usage: bun smart-search.js "query" [--limit=N] [--provider=yandex|brave|tavily|auto] [--format=json|text|markdown] [--scrape] [--scrape-top=N]');
  process.exit(1);
}

/**
 * Run a command via Bun.spawn and return stdout
 */
async function runCommand(cmd, args, input = null) {
  const proc = Bun.spawn([cmd, ...args], {
    stdin: input ? new TextEncoder().encode(input) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    throw new Error(stderr || `Exit code ${exitCode}`);
  }
  
  if (stderr) console.error(stderr);
  return stdout;
}

/**
 * Detect if query contains Cyrillic characters
 */
function isCyrillic(text) {
  return /[\u0400-\u04FF]/.test(text);
}

/**
 * Choose search provider based on query language
 */
function chooseProvider(query, userChoice) {
  if (userChoice !== 'auto') {
    return userChoice;
  }
  
  // Always use Yandex for all languages (supports both RU and international search)
  return 'yandex';
}

/**
 * Search using Yandex Search API
 */
async function searchYandex(query, limit, format) {
  return runCommand('bun', [import.meta.dir + '/search.js', query, `--limit=${limit}`, `--format=${format}`]);
}

/**
 * Search using Tavily Search API (via fetch)
 *
 * Requires TAVILY_API_KEY environment variable or config.tavilyApiKey.
 */
async function searchTavily(query, limit, format) {
  const tavilyApiKey = process.env.TAVILY_API_KEY || loadTavilyConfigKey();
  if (!tavilyApiKey) {
    console.error('ERROR: TAVILY_API_KEY environment variable not set');
    console.error('Please set TAVILY_API_KEY or add tavilyApiKey to config.json, or use --provider=yandex');
    process.exit(1);
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query: query,
      max_results: limit,
      search_depth: 'advanced',
      include_answer: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const results = (data.results || []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
    domain: new URL(r.url).hostname,
  }));

  if (format === 'json') {
    return JSON.stringify({
      query: query,
      found: results.length,
      results: results,
    }, null, 2);
  } else if (format === 'markdown') {
    let output = `# Search Results: "${query}"\n`;
    output += `Found: ${results.length} results\n\n`;

    results.forEach((result, index) => {
      output += `## ${index + 1}. ${result.title}\n`;
      output += `**URL:** ${result.url}\n`;
      output += `**Domain:** ${result.domain}\n\n`;
      if (result.snippet) {
        output += `${result.snippet}\n\n`;
      }
      output += `---\n\n`;
    });

    return output;
  } else {
    let output = `Search: "${query}" (found ${results.length} results)\n\n`;

    results.forEach((result, index) => {
      output += `${index + 1}. ${result.title}\n`;
      output += `   ${result.url}\n`;
      if (result.snippet) {
        output += `   ${result.snippet}\n`;
      }
      output += '\n';
    });

    return output;
  }
}

/**
 * Extract content from URLs using Tavily Extract API.
 * Used as an alternative to Ollama-based scraping when --provider=tavily.
 */
async function tavilyExtract(urls) {
  const tavilyApiKey = process.env.TAVILY_API_KEY || loadTavilyConfigKey();
  if (!tavilyApiKey) {
    console.error('ERROR: TAVILY_API_KEY not set for Tavily Extract');
    return [];
  }

  const response = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      urls: urls.slice(0, 20),
    }),
  });

  if (!response.ok) {
    console.error(`Tavily Extract error ${response.status}`);
    return [];
  }

  const data = await response.json();
  return (data.results || []).map(r => ({
    url: r.url,
    title: '',
    main_content: r.raw_content || r.content || '',
    description: '',
  }));
}

/**
 * Load tavilyApiKey from config.json if present
 */
function loadTavilyConfigKey() {
  try {
    const configPath = import.meta.dir + '/config.json';
    const config = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
    return config.tavilyApiKey || null;
  } catch {
    return null;
  }
}

/**
 * Search using Brave Search API (via curl)
 * 
 * Note: This requires BRAVE_API_KEY environment variable to be set.
 */
async function searchBrave(query, limit, format) {
  // Check if BRAVE_API_KEY is set
  if (!process.env.BRAVE_API_KEY) {
    console.error('ERROR: BRAVE_API_KEY environment variable not set');
    console.error('Please set BRAVE_API_KEY or use --provider=yandex');
    process.exit(1);
  }
  
  // Use curl to call Brave Search API
  const url = 'https://api.search.brave.com/res/v1/web/search';
  const stdout = await runCommand('curl', [
    '-s',
    '-H', 'Accept: application/json',
    '-H', `X-Subscription-Token: ${process.env.BRAVE_API_KEY}`,
    `${url}?q=${encodeURIComponent(query)}&count=${limit}`
  ]);
  
  // Parse Brave API response
  const data = JSON.parse(stdout);
  
  // Convert to common format
  if (format === 'json') {
    return JSON.stringify({
      query: query,
      found: data.web?.total || 0,
      results: (data.web?.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
        domain: new URL(r.url).hostname
      }))
    }, null, 2);
  } else if (format === 'markdown') {
    let output = `# Search Results: "${query}"\n`;
    output += `Found: ${data.web?.total || 0} results\n\n`;
    
    (data.web?.results || []).forEach((result, index) => {
      output += `## ${index + 1}. ${result.title}\n`;
      output += `**URL:** ${result.url}\n`;
      output += `**Domain:** ${new URL(result.url).hostname}\n\n`;
      if (result.description) {
        output += `${result.description}\n\n`;
      }
      output += `---\n\n`;
    });
    
    return output;
  } else {
    // text format
    let output = `Search: "${query}" (found ${data.web?.total || 0} results)\n\n`;
    
    (data.web?.results || []).forEach((result, index) => {
      output += `${index + 1}. ${result.title}\n`;
      output += `   ${result.url}\n`;
      if (result.description) {
        output += `   ${result.description}\n`;
      }
      output += '\n';
    });
    
    return output;
  }
}

const SCRAPER = import.meta.dir + '/../web-scraper/scripts/scrape.js';

/**
 * Scrape a single URL via web-scraper skill
 * Returns { title, main_content, description } or null on error
 */
async function scrapeUrl(url) {
  try {
    const out = await runCommand('bun', [SCRAPER, '--url', url, '--compact']);
    const json = JSON.parse(out.trim());
    // Skip if no content
    if (!json.main_content || json.main_content.length < 50) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Enrich search results with scraped page content
 */
async function enrichWithScraping(searchOutput, topN) {
  let data;
  try {
    data = JSON.parse(searchOutput);
  } catch {
    // Non-JSON output — can't enrich
    return searchOutput;
  }

  const urls = (data.results || []).slice(0, topN).map(r => r.url).filter(Boolean);
  console.error(`[Scraping ${urls.length} URLs...]`);

  // Scrape sequentially — Ollama не любит параллельные запросы
  const scraped = [];
  for (const url of urls) {
    const result = await scrapeUrl(url);
    console.error(`[scraped ${url.slice(0, 50)}: ${result ? result.main_content?.length + ' chars' : 'null'}]`);
    scraped.push(result);
  }

  // Merge scraped content into results
  data.results = data.results.map((result, i) => {
    const s = scraped[i];
    if (s) {
      return {
        ...result,
        scraped_title: s.title || result.title,
        scraped_content: s.main_content,
        scraped_description: s.description || ''
      };
    }
    return result;
  });

  return JSON.stringify(data, null, 2);
}

/**
 * Enrich search results with Tavily Extract (alternative to Ollama scraping)
 */
async function enrichWithTavilyExtract(searchOutput, topN) {
  let data;
  try {
    data = JSON.parse(searchOutput);
  } catch {
    return searchOutput;
  }

  const urls = (data.results || []).slice(0, topN).map(r => r.url).filter(Boolean);
  console.error(`[Extracting ${urls.length} URLs via Tavily Extract...]`);

  const extracted = await tavilyExtract(urls);
  const extractedByUrl = Object.fromEntries(extracted.map(e => [e.url, e]));

  data.results = data.results.map((result) => {
    const e = extractedByUrl[result.url];
    if (e && e.main_content && e.main_content.length >= 50) {
      return {
        ...result,
        scraped_title: e.title || result.title,
        scraped_content: e.main_content,
        scraped_description: e.description || '',
      };
    }
    return result;
  });

  return JSON.stringify(data, null, 2);
}

/**
 * Main function
 */
async function main() {
  const selectedProvider = chooseProvider(query, provider);

  console.error(`[Using provider: ${selectedProvider}]`);

  // Always fetch JSON internally when scraping, convert format after
  const fetchFormat = scrape ? 'json' : format;

  try {
    let result;
    if (selectedProvider === 'yandex') {
      result = await searchYandex(query, limit, fetchFormat);
    } else if (selectedProvider === 'tavily') {
      result = await searchTavily(query, limit, fetchFormat);
    } else {
      result = await searchBrave(query, limit, fetchFormat);
    }

    if (scrape) {
      if (selectedProvider === 'tavily') {
        result = await enrichWithTavilyExtract(result, scrapeTop);
      } else {
        result = await enrichWithScraping(result, scrapeTop);
      }
    }

    console.log(result);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
