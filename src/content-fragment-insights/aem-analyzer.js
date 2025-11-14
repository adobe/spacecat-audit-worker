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

import { AemClient } from './clients/aem-client.js';
import { FragmentAnalyzer } from './fragment-analyzer.js';

export class AemAnalyzer {
  static DEFAULT_FRAGMENT_ROOT_PATH = '/content/dam/';

  // Max. pages to fetch for pagination to prevent long-running queries
  static MAX_PAGES = 20;

  constructor(context) {
    const { log } = context;

    this.log = log;

    this.aemClient = AemClient.createFrom(context);
    this.fragmentAnalyzer = new FragmentAnalyzer(log);

    this.rootPath = AemAnalyzer.DEFAULT_FRAGMENT_ROOT_PATH;
    this.fragments = [];
  }

  static parseFragment(fragment) {
    if (!fragment) {
      return null;
    }

    const fragmentPath = fragment.path;
    const status = fragment.status.toUpperCase();
    const createdAt = fragment.created?.at || null;
    const modifiedAt = fragment.modified?.at || null;
    const publishedAt = fragment.published?.at || null;

    return {
      fragmentPath,
      status,
      createdAt,
      modifiedAt,
      publishedAt,
      lastModified: modifiedAt || createdAt || null,
    };
  }

  async findUnusedFragments() {
    await this.fetchAllFragments();

    const unusedFragments = this.fragmentAnalyzer.findUnusedFragments(this.fragments);

    return {
      totalFragments: this.fragments.length,
      totalUnused: unusedFragments.length,
      unusedFragments,
    };
  }

  async fetchAllFragments() {
    const fragments = [];
    let cursor = null;
    let pageCount = 0;

    this.log.info(`[Content Fragment Insights] Fetching fragments from ${this.rootPath}`);

    do {
      // eslint-disable-next-line no-await-in-loop
      const { items, cursor: nextCursor } = await this.aemClient.getFragments(
        this.rootPath,
        { cursor, projection: 'minimal' },
      );

      items.forEach((item) => {
        const parsedFragment = AemAnalyzer.parseFragment(item);
        if (parsedFragment) {
          fragments.push(parsedFragment);
        }
      });

      cursor = nextCursor;
      pageCount += 1;

      if (cursor) {
        // TODO: Add rate limiting
      }
    } while (cursor && pageCount < AemAnalyzer.MAX_PAGES);

    if (cursor) {
      this.log.warn(`[Content Fragment Insights] Reached pagination limit (${AemAnalyzer.MAX_PAGES}) for ${this.rootPath}. Results may be incomplete.`);
    }

    this.log.info(`[Content Fragment Insights] Collected ${fragments.length} fragments from ${this.rootPath}`);

    this.fragments = fragments;
  }
}
