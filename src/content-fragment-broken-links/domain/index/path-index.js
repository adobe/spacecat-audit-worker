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

import { ContentPath } from '../content/content-path.js';
import { PathNode } from './path-node.js';

export class PathIndex {
  constructor(context) {
    this.context = context;
    this.root = new PathNode();
  }

  insert(path, status, locale) {
    const contentPath = new ContentPath(path, status, locale);
    this.insertContentPath(contentPath);
  }

  insertContentPath(contentPath) {
    if (!contentPath.isValid()) {
      return;
    }

    let current = this.root;
    for (const letter of contentPath.path) {
      if (!current.children.has(letter)) {
        current.children.set(letter, new PathNode());
      }
      current = current.children.get(letter);
    }

    const existed = current.isEnd && current.path !== null;
    current.isEnd = true;
    current.path = contentPath;

    if (!existed) {
      const { log } = this.context;
      log.debug(`Inserted new path: ${contentPath.path}`);
    }
  }

  contains(path) {
    if (!path || path.length === 0) {
      return false;
    }

    let current = this.root;
    for (const letter of path) {
      if (!current.children.has(letter)) {
        return false;
      }
      current = current.children.get(letter);
    }

    return current.isEnd && current.path !== null;
  }

  find(path) {
    if (!path || path.length === 0) {
      return null;
    }

    let current = this.root;
    for (const letter of path) {
      if (!current.children.has(letter)) {
        return null;
      }
      current = current.children.get(letter);
    }

    return current.isEnd ? current.path : null;
  }

  delete(path) {
    if (!path || path.length === 0) {
      return false;
    }

    let current = this.root;
    for (const letter of path) {
      if (!current.children.has(letter)) {
        return false;
      }
      current = current.children.get(letter);
    }

    if (current.isEnd) {
      current.isEnd = false;
      current.path = null;
      return true;
    }

    return false;
  }

  findChildren(parentPath) {
    const directChildren = [];
    const allChildren = this.findPathsWithPrefix(`${parentPath}/`);

    for (const child of allChildren) {
      const childPath = child.path;
      const relativePath = childPath.substring(parentPath.length + 1);

      // Check if this is a direct child
      if (!relativePath.includes('/')) {
        directChildren.push(child);
      }
    }

    return directChildren;
  }

  findPathsWithPrefix(prefix) {
    if (!prefix || prefix.length === 0) {
      return this.getPaths();
    }

    const paths = [];
    let current = this.root;

    for (const letter of prefix) {
      if (!current.children.has(letter)) {
        return paths; // Prefix not found
      }
      current = current.children.get(letter);
    }

    // Collect all paths from this node
    this.getPathsFromNode(current, prefix, paths);
    return paths;
  }

  getPaths() {
    const paths = [];
    this.getPathsFromNode(this.root, '', paths);
    return paths;
  }

  getPathsFromNode(node, currentPath, paths) {
    if (node.isEnd && node.path !== null) {
      paths.push(node.path);
    }

    for (const [letter, child] of node.children) {
      this.getPathsFromNode(child, currentPath + letter, paths);
    }
  }
}
