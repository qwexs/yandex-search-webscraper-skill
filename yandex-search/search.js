#!/usr/bin/env bun
// @ts-check

/**
 * Yandex Search API - Web search via Yandex
 * Usage: bun search.js "query" [--limit N] [--region REGION] [--output FILE] [--format FORMAT]
 */

// Parse command line arguments
const args = process.argv.slice(2);
const query = args.find(arg => !arg.startsWith('--'));
const limit = parseInt(args.find(arg => arg.startsWith('--limit'))?.split('=')[1] || '10');
const region = args.find(arg => arg.startsWith('--region'))?.split('=')[1] || 'auto';
const outputFile = args.find(arg => arg.startsWith('--output'))?.split('=')[1];
const format = args.find(arg => arg.startsWith('--format'))?.split('=')[1] || 'text';

if (!query) {
  console.error('Usage: bun search.js "query" [--limit=N] [--region=REGION] [--output=FILE] [--format=FORMAT]');
  process.exit(1);
}

// Load config
const configPath = import.meta.dir + '/config.json';
let config = {};
try {
  config = await Bun.file(configPath).json();
} catch {}

// Environment variables override config
const apiKey = process.env.YANDEX_SEARCH_API_KEY || config.apiKey;
const folderId = process.env.YANDEX_FOLDER_ID || config.folderId;

if (!apiKey || !folderId) {
  console.error('ERROR: Missing API key or folder ID');
  console.error('Set YANDEX_SEARCH_API_KEY and YANDEX_FOLDER_ID environment variables,');
  console.error('or create skills/yandex-search/config.json with apiKey and folderId');
  process.exit(1);
}

// Map region shorthand to searchType
const searchTypeMap = {
  'ru': 'SEARCH_TYPE_RU',
  'com': 'SEARCH_TYPE_COM',
  'tr': 'SEARCH_TYPE_TR',
  'ua': 'SEARCH_TYPE_UA'
};

// Auto-detect search type based on query language if region is 'auto' or not specified
let searchType;
if (region === 'auto' || !searchTypeMap[region]) {
  // Detect Cyrillic -> RU search, Latin -> COM search
  const isCyrillic = /[\u0400-\u04FF]/.test(query);
  searchType = isCyrillic ? 'SEARCH_TYPE_RU' : 'SEARCH_TYPE_COM';
} else {
  searchType = searchTypeMap[region];
}

// Make API request
try {
  const response = await fetch('https://searchapi.api.cloud.yandex.net/v2/web/search', {
    method: 'POST',
    headers: {
      'Authorization': `Api-Key ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: {
        searchType: searchType,
        queryText: query
      },
      folderId: folderId
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`ERROR: HTTP ${response.status}`);
    console.error(errorText);
    process.exit(1);
  }

  const data = await response.json();

  if (!data.rawData) {
    console.error('ERROR: No rawData in response');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // Decode Base64 XML
  const xmlData = Buffer.from(data.rawData, 'base64').toString('utf8');

  // Parse XML to extract results
  const results = parseYandexXML(xmlData);

  // Format output
  const output = formatResults(results, format);

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
 * Parse Yandex Search XML response
 */
function parseYandexXML(xml) {
  const results = [];

  // Extract query
  const queryMatch = xml.match(/<query>(.*?)<\/query>/);
  const queryText = queryMatch ? queryMatch[1] : '';

  // Extract total found
  const foundMatch = xml.match(/<found priority="all">(\d+)<\/found>/);
  const found = foundMatch ? parseInt(foundMatch[1]) : 0;

  // Extract groups (each contains a doc)
  const groupRegex = /<group>([\s\S]*?)<\/group>/g;
  let groupMatch;

  while ((groupMatch = groupRegex.exec(xml)) !== null) {
    const groupXml = groupMatch[1];

    // Extract doc from group
    const docMatch = groupXml.match(/<doc[^>]*>([\s\S]*?)<\/doc>/);
    if (!docMatch) continue;

    const docXml = docMatch[1];

    // Extract fields
    const urlMatch = docXml.match(/<url>(.*?)<\/url>/);
    const titleMatch = docXml.match(/<title>(.*?)<\/title>/);
    const domainMatch = docXml.match(/<domain>(.*?)<\/domain>/);

    // Extract passages (snippets)
    const passageRegex = /<passage>(.*?)<\/passage>/g;
    const passages = [];
    let passageMatch;
    while ((passageMatch = passageRegex.exec(docXml)) !== null) {
      // Remove <hlword> tags but keep the text
      const cleanPassage = passageMatch[1].replace(/<\/?hlword>/g, '');
      passages.push(cleanPassage);
    }

    if (urlMatch && titleMatch) {
      results.push({
        title: titleMatch[1].replace(/<\/?hlword>/g, ''),
        url: urlMatch[1],
        snippet: passages.join(' '),
        domain: domainMatch ? domainMatch[1] : ''
      });
    }
  }

  return {
    query: queryText,
    found: found,
    results: results.slice(0, limit)
  };
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
