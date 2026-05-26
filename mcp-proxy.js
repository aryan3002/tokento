#!/usr/bin/env node

/**
 * MCP Stdio Proxy for Tokento
 * 
 * Claude Desktop requires MCP servers to communicate over standard input/output (stdio).
 * Because the Tokento MCP Adapter is built for Cloudflare Workers (HTTP), this script
 * acts as a bridge. It listens to Claude's stdio commands and forwards them as HTTP POST 
 * requests to your local Wrangler dev server.
 */

const http = require('http');

// Read JSON-RPC messages from stdin (one per line)
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  // Forward the exact JSON payload to the local Cloudflare Worker
  const req = http.request({
    hostname: 'localhost',
    port: 8787,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(line)
    }
  }, (res) => {
    let responseData = '';
    res.on('data', chunk => responseData += chunk);
    res.on('end', () => {
      // Print the response back to stdout so Claude can read it
      console.log(responseData);
    });
  });

  req.on('error', (e) => {
    console.error(`Proxy Error: ${e.message}`);
  });

  req.write(line);
  req.end();
});
