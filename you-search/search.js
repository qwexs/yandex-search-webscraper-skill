#!/usr/bin/env bun
// @ts-check

/**
 * You.com Search - Web search via the You.com MCP server
 * Usage: bun search.js "query" [--limit N] [--output FILE] [--format FORMAT]
 *
 * Keyless by default (You.com free profile). Set YDC_API_KEY to use the
 * authenticated profile.
 */

// Parse command line arguments
const args = process.argv.slice(2);
const query = args.find(arg => !arg.startsWith('--'));

function getOption(name, fallback) {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : fallback;
}

const limit = parseInt(getOption('--limit', '10'));
const outputFile = getOption('--output');
const format = getOption('--format', 'text');

if (!query) {
  console.error('Usage: bun search.js "query" [--limit=N] [--output=FILE] [--format=FORMAT]');
  process.exit(1);
}

if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  console.error('ERROR: --limit must be an integer between 1 and 100');
  process.exit(1);
}

// Load config (optional)
const configPath = import.meta.dir + '/config.json';
let config = {};
try {
  config = await Bun.file(configPath).json();
} catch {}

// Environment variables override config
const apiKey = process.env.YDC_API_KEY || config.apiKey;

// Keyless free profile by default; authenticated profile with an API key
const endpoint = apiKey
  ? 'https://api.you.com/mcp'
  : 'https://api.you.com/mcp?profile=free';

// Make MCP request
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'you-search',
        arguments: {
          query: query,
          count: limit,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`ERROR: HTTP ${response.status}`);
    console.error(errorText);
    process.exit(1);
  }

  // The MCP server replies as Server-Sent Events; each data line is a JSON-RPC message
  const body = await response.text();
  const messages = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      try {
        messages.push(JSON.parse(trimmed.slice(5).trim()));
      } catch {}
    }
  }

  const message = messages.find(m => m && m.result);
  if (!message) {
    console.error('ERROR: No result in MCP response');
    console.error(body);
    process.exit(1);
  }

  if (message.result.isError) {
    const errorText = (message.result.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    console.error('ERROR: you-search tool failed');
    console.error(errorText);
    process.exit(1);
  }

  // Tool output is a JSON document inside the first text content block
  const textContent = (message.result.content || []).find(c => c.type === 'text');
  if (!textContent) {
    console.error('ERROR: No text content in MCP response');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(textContent.text);
  } catch {
    console.error('ERROR: Unexpected you-search output');
    console.error(textContent.text.slice(0, 500));
    process.exit(1);
  }

  // Map You.com web results to the common skill format
  const web = payload.results?.web || [];
  const results = web.slice(0, limit).map(r => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || (r.contents?.highlights || []).slice(0, 2).join(' '),
    domain: hostOf(r.url),
  }));

  // Format output
  const data = { query: query, found: results.length, results: results };
  const output = formatResults(data, format);

  // Print or save
  if (outputFile) {
    await Bun.write(outputFile, output);
    console.log(`Results saved to ${outputFile}`);
  } else {
    console.log(output);
  }

} catch (error) {
  console.error('ERROR:', error.message);
  process.exit(1);
}

/**
 * Extract hostname safely
 */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Format results for output
 */
function formatResults(data, format) {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }

  if (format === 'markdown') {
    let output = `# Search Results: "${data.query}"\n`;
    output += `Found: ${data.found.toLocaleString()} results\n\n`;

    data.results.forEach((result, index) => {
      output += `## ${index + 1}. ${result.title}\n`;
      output += `**URL:** ${result.url}\n`;
      output += `**Domain:** ${result.domain}\n\n`;
      if (result.snippet) {
        output += `${result.snippet}\n\n`;
      }
      output += `---\n\n`;
    });

    return output;
  }

  // Default: text format
  let output = `Search: "${data.query}" (found ${data.found.toLocaleString()} results)\n\n`;

  data.results.forEach((result, index) => {
    output += `${index + 1}. ${result.title}\n`;
    output += `   ${result.url}\n`;
    if (result.snippet) {
      output += `   ${result.snippet}\n`;
    }
    output += '\n';
  });

  return output;
}
