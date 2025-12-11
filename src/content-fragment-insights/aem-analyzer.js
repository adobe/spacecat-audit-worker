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

  static MAX_FETCH_ATTEMPTS = 3;

  static ERROR_CODE_TIMEOUT = 'ETIMEOUT';

  constructor(aemClient, log) {
    this.log = log;
    this.aemClient = aemClient;
    this.fragmentAnalyzer = new FragmentAnalyzer(log);
    this.rootPath = AemAnalyzer.DEFAULT_FRAGMENT_ROOT_PATH;
    this.fragments = [];
  }

  static async createFrom(context) {
    const { log } = context;
    const aemClient = await AemClient.createFrom(context);
    return new AemAnalyzer(aemClient, log);
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
      data: unusedFragments,
    };
  }

  async fetchAllFragments() {
    const fragments = [];
    let cursor = null;

    this.log.info(`[Content Fragment Insights] Fetching fragments from ${this.rootPath}`);

    // For large tenants, this fetch loop can take minutes. Add pagination if needed in the future
    do {
      // eslint-disable-next-line no-await-in-loop
      const { items, cursor: nextCursor } = await this.fetchFragmentsPage({ cursor });

      items.forEach((item) => {
        const parsedFragment = AemAnalyzer.parseFragment(item);
        if (parsedFragment) {
          fragments.push(parsedFragment);
        }
      });

      cursor = nextCursor;

      if (cursor) {
        // Be respectful to the API
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
    } while (cursor);

    this.log.info(`[Content Fragment Insights] Collected ${fragments.length} fragments from ${this.rootPath}`);

    this.fragments = fragments;
  }

  async fetchFragmentsPage({ cursor }) {
    const options = {
      cursor,
      projection: 'minimal',
    };

    let result = { items: [], cursor: null };

    for (let attempt = 0; attempt < AemAnalyzer.MAX_FETCH_ATTEMPTS; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await this.aemClient.getFragments(this.rootPath, options);
        break;
      } catch (error) {
        const isTimeout = error?.code === AemAnalyzer.ERROR_CODE_TIMEOUT;
        const isTokenExpired = this.aemClient.isTokenExpired();

        if (!isTimeout && !isTokenExpired) {
          throw error;
        }

        if (isTimeout) {
          this.log.warn(
            `[Content Fragment Insights] Timeout while fetching fragment page. Retrying... attempt ${attempt + 1}/${AemAnalyzer.MAX_FETCH_ATTEMPTS}`,
          );
        } else if (isTokenExpired) {
          this.log.warn(
            `[Content Fragment Insights] Token expired. Refreshing and retrying... attempt ${attempt + 1}/${AemAnalyzer.MAX_FETCH_ATTEMPTS}`,
          );
        }
      }
    }

    return result;
  }
}
