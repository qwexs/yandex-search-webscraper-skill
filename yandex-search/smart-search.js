#!/usr/bin/env bun
// @ts-check

/**
 * Smart Web Search - Automatically chooses between Yandex and Brave Search
 * based on query language
 * 
 * Usage: bun smart-search.js "query" [--limit N] [--provider yandex|brave|auto] [--format json|text|markdown]
 */

// Parse arguments
const args = process.argv.slice(2);
const query = args.find(arg => !arg.startsWith('--'));
const limit = parseInt(args.find(arg => arg.startsWith('--limit'))?.split('=')[1] || '10');
const provider = args.find(arg => arg.startsWith('--provider'))?.split('=')[1] || 'auto';
const format = args.find(arg => arg.startsWith('--format'))?.split('=')[1] || 'text';
const scrape = args.includes('--scrape');
const scrapeTop = parseInt(args.find(arg => arg.startsWith('--scrape-top'))?.split('=')[1] || '3');
const scrapeMode = args.find(arg => arg.startsWith('--scrape-mode'))?.split('=')[1] || 'auto';
const scrapeConcurrency = parseInt(args.find(arg => arg.startsWith('--scrape-concurrency'))?.split('=')[1] || '2');

if (!['auto', 'http', 'dynamic', 'stealth'].includes(scrapeMode)) {
  console.error(`Invalid --scrape-mode: ${scrapeMode}`);
  process.exit(1);
}
if (!Number.isInteger(scrapeConcurrency) || scrapeConcurrency < 1) {
  console.error('--scrape-concurrency must be a positive integer');
  process.exit(1);
}

if (!query) {
  console.error('Usage: bun smart-search.js "query" [--limit=N] [--provider=yandex|brave|auto] [--format=json|text|markdown] [--scrape] [--scrape-top=N] [--scrape-mode=auto|http|dynamic|stealth] [--scrape-concurrency=N]');
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

const SCRAPER = import.meta.dir + '/../web-scraper/scripts/scrape.py';

/**
 * Scrape a single URL via web-scraper skill
 * Returns clean Markdown or null on error
 */
async function scrapeUrl(url, mode) {
  try {
    const output = await runCommand('python', [SCRAPER, '--url', url, '--mode', mode]);
    return JSON.parse(output);
  } catch (error) {
    return {
      url,
      markdown: null,
      strategy: null,
      status: null,
      blocked: false,
      elapsed_ms: 0,
      error: error.message,
    };
  }
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * Enrich search results with scraped page content
 */
async function enrichWithScraping(searchOutput, topN, mode, concurrency) {
  let data;
  try {
    data = JSON.parse(searchOutput);
  } catch {
    // Non-JSON output — can't enrich
    return searchOutput;
  }

  const urls = (data.results || []).slice(0, topN).map(r => r.url).filter(Boolean);
  console.error(`[Scraping ${urls.length} URLs...]`);

  const scraped = await mapLimit(urls, Math.max(1, concurrency), async (url) => {
    const result = await scrapeUrl(url, mode);
    console.error(`[scraped ${url.slice(0, 50)}: ${result.strategy || 'failed'}, ${result.markdown?.length || 0} chars]`);
    return result;
  });

  // Merge scraped content into results
  data.results = data.results.map((result, i) => {
    const scrapeResult = scraped[i];
    if (scrapeResult) {
      return {
        ...result,
        scraped_content: scrapeResult.markdown,
        scrape: {
          final_url: scrapeResult.final_url,
          title: scrapeResult.title,
          strategy: scrapeResult.strategy,
          status: scrapeResult.status,
          blocked: scrapeResult.blocked,
          elapsed_ms: scrapeResult.elapsed_ms,
          error: scrapeResult.error,
        },
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
    } else {
      result = await searchBrave(query, limit, fetchFormat);
    }

    if (scrape) {
      result = await enrichWithScraping(result, scrapeTop, scrapeMode, scrapeConcurrency);
    }

    console.log(result);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
