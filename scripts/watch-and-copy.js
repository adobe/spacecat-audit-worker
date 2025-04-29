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
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.join(__dirname, '..', 'src');
const destDir = path.join(__dirname, '..', '.aws-sam/build/SpacecatAuditWorkerFunction/src');

function copyFile(filePath) {
  try {
    const relativePath = path.relative(srcDir, filePath);
    const destPath = path.join(destDir, relativePath);

    // Skip files that start with a dot
    if (path.basename(filePath).startsWith('.')) {
      return;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    // Read and compare file contents
    const srcContent = fs.readFileSync(filePath);
    let destContent;
    try {
      destContent = fs.readFileSync(destPath);
    } catch {
      // If the destination file doesn't exist, proceed with copying
      destContent = null;
    }

    if (!destContent || !srcContent.equals(destContent)) {
      fs.copyFileSync(filePath, destPath);
      console.log(`Copied ${filePath} to ${destPath}`);
    }
  } catch (error) {
    console.error(`Error copying file ${filePath}:`, error);
  }
}

// Initialize watcher.
const watcher = chokidar.watch(srcDir, {
  ignored: /(^|[\\])\../, // ignore dotfiles
  persistent: true,
});

// Add event listeners.
watcher
  .on('add', copyFile)
  .on('change', copyFile)
  .on('error', (error) => console.error(`Watcher error: ${error}`));

console.log(`Watching for changes in ${srcDir}...`);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Stopping file watcher...');
  watcher.close().then(() => {
    console.log('File watcher closed.');
    process.exit(0);
  });
});

// Output some initial stats
setTimeout(() => {
  const watchedPaths = watcher.getWatched();
  const fileCount = Object.values(watchedPaths).reduce((acc, files) => acc + files.length, 0);
  console.log(`Watching ${fileCount} files in ${Object.keys(watchedPaths).length} directories`);
}, 2000);
