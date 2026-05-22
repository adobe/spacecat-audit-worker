#!/usr/bin/env node
/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Transforms a topics CSV (as exported from the LLMO/Semrush pipeline) into JSON.
 *
 * Usage:
 *   node scripts/csv-to-json.js <input.csv> [output.json]
 *
 * If output path is omitted, the JSON is written next to the input file with a .json extension.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, basename, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // escaped double-quote inside a quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((h, i) => {
        const raw = values[i] ?? '';
        // coerce numeric columns
        const num = Number(raw);
        return [h, raw !== '' && !Number.isNaN(num) ? num : raw];
      }),
    );
  });
}

const [,, inputArg, outputArg] = process.argv;

if (!inputArg) {
  const scriptName = basename(fileURLToPath(import.meta.url));
  process.stderr.write(`Usage: node scripts/${scriptName} <input.csv> [output.json]\n`);
  process.exit(1);
}

const inputPath = resolve(__dirname, '..', inputArg);
const outputPath = outputArg
  ? resolve(__dirname, '..', outputArg)
  : inputPath.replace(extname(inputPath), '.json');

const csv = readFileSync(inputPath, 'utf-8');
const json = parseCsv(csv);

writeFileSync(outputPath, JSON.stringify(json, null, 2), 'utf-8');
process.stdout.write(`Wrote ${json.length} records to ${outputPath}\n`);
