/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Simple HTTP server for the SEO Validator UI
 *
 * Usage:
 *   node test/dev/validator-server.mjs
 *
 * Then open: http://localhost:3033
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3033;

// Run validation using the CLI tool
async function runValidation(urls) {
  return new Promise((resolve, reject) => {
    // Create temporary input file
    const tempInput = path.join(__dirname, `temp-${Date.now()}.json`);
    const tempOutput = path.join(__dirname, `temp-result-${Date.now()}.json`);
    
    const urlObjects = urls.map(url => ({ url }));
    fs.writeFileSync(tempInput, JSON.stringify(urlObjects, null, 2));
    
    // Run the CLI validator
    const validatorScript = path.join(__dirname, 'validate-urls.mjs');
    const child = spawn('node', [validatorScript, tempInput, tempOutput], {
      cwd: path.join(__dirname, '..', '..'),
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    child.on('close', (code) => {
      // Clean up temp input file
      try {
        fs.unlinkSync(tempInput);
      } catch (e) {
        // Ignore
      }
      
      if (code !== 0) {
        reject(new Error(`Validation failed: ${errorOutput}`));
        return;
      }
      
      try {
        const results = JSON.parse(fs.readFileSync(tempOutput, 'utf8'));
        // Clean up temp output file
        fs.unlinkSync(tempOutput);
        resolve(results);
      } catch (error) {
        reject(new Error(`Failed to parse results: ${error.message}`));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve the HTML UI at root
  if (req.url === '/' && req.method === 'GET') {
    const htmlPath = path.join(__dirname, 'validator-ui.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading UI');
    }
    return;
  }

  // Handle validation API endpoint
  if (req.url === '/validate' && req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { urls } = JSON.parse(body);

        if (!Array.isArray(urls) || urls.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid input: urls array required' }));
          return;
        }

        console.log(`\n🔍 Validating ${urls.length} URLs...`);

        // Run validation using the CLI tool
        const response = await runValidation(urls);

        console.log(`✅ Clean: ${response.metadata.cleanUrls} | ❌ Blocked: ${response.metadata.blockedUrls}\n`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        console.error('Validation error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           SEO Validator Server Running                        ║
╚════════════════════════════════════════════════════════════════╝

🌐 Open in browser: http://localhost:${PORT}

📋 Usage:
   1. Open the URL above in your browser
   2. Paste URLs (one per line) into the text area
   3. Click "Check URLs" to run validation
   4. Export results as JSON or CSV

🛑 Press Ctrl+C to stop the server

`);
});

