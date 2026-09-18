/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// A YouTube video id is `[A-Za-z0-9_-]`; length isn't constrained (test fixtures use short ids,
// real ids are 11 chars) — the host/path gate below already guarantees it's a video slot.
const YT_VIDEO_ID = /^[\w-]+$/;

/**
 * Extracts the video id from a YouTube watch (`youtube.com/watch?v=<id>`) or short
 * (`youtu.be/<id>`) URL. Returns `null` for anything else (channels, shorts, playlists,
 * non-YouTube, unparseable).
 *
 * Used to dedupe the two forms of the same video: `youtube.com/watch?v=ID` and `youtu.be/ID`
 * share a video id, so they collapse to one URL-store entry (and their citations sum) even
 * though the exact URL strings differ. The URL *form* itself is preserved (first occurrence
 * kept) — Semrush's url-prompts keys on the exact form it returned, which can be either.
 *
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function youtubeVideoId(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return YT_VIDEO_ID.test(id) ? id : null;
  }
  if ((host === 'youtube.com' || host === 'youtube-nocookie.com') && parsed.pathname === '/watch') {
    const id = parsed.searchParams.get('v');
    return id && YT_VIDEO_ID.test(id) ? id : null;
  }
  return null;
}

/**
 * Normalizes a YouTube URL by keeping only essential identifiers, PRESERVING the URL form.
 * - `/watch?v=<id>&…` → `${origin}/watch?v=<id>` (keep only `v=`, drop other query params)
 * - other YouTube URLs (`youtu.be`, shorts, channels) → `${origin}${pathname}` (query stripped)
 *
 * The host/scheme/short-vs-watch form is deliberately NOT rewritten to a single canonical form:
 * Semrush's `url-prompts` keys prompts on the exact `CBF_source` string it returned from
 * `domain-urls`, which may be either the `watch` or the `youtu.be` form — preserving whatever
 * came from the source keeps that exact match intact. The two forms of the same video (when
 * both appear) are reconciled by video id at dedupe time instead (see {@link youtubeVideoId} and
 * its use in the domain-urls loader), not by rewriting one form into the other.
 *
 * Shared by both call sites that classify/store offsite URLs
 * (`offsite-brand-presence-enrichment.js`'s legacy PostgREST/SharePoint path and
 * `offsite-brand-presence/handler.js`'s Semrush `domain-urls` path) so the one rule lives in one
 * place.
 *
 * @param {URL} parsed - Parsed URL object (already known to be a `youtube.com`/`youtu.be` host).
 * @returns {string} Normalized URL
 */
export function normalizeYoutubeUrl(parsed) {
  const { pathname } = parsed;

  if (pathname.startsWith('/watch')) {
    const videoId = parsed.searchParams.get('v');
    if (videoId) {
      return `${parsed.origin}/watch?v=${videoId}`;
    }
  }

  return `${parsed.origin}${pathname}`;
}
