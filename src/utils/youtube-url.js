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

/**
 * Small helpers for canonicalizing YouTube video URLs to a single form.
 *
 * The offsite pipeline stores a video by its **canonical watch URL**
 * `https://www.youtube.com/watch?v=<id>` (extra params like `t=`/`list=` stripped). Semrush's
 * URL-Inspector keys prompts on that same watch URL (exact `CBF_source` match), so both the
 * stored form and the `url-prompts` query must use it — the short `youtu.be/<id>` alias does not
 * match. These helpers convert between the two so a URL stored/collected in either form resolves
 * to the same video.
 */

// A YouTube video id is 11 chars of `[A-Za-z0-9_-]`; allow a small range for forward-compat.
const YT_VIDEO_ID = /^[\w-]{8,15}$/;

/**
 * Extracts the video id from a YouTube watch (`youtube.com/watch?v=<id>`) or short
 * (`youtu.be/<id>`) URL. Returns `null` for anything else (channels, shorts, playlists,
 * non-YouTube, unparseable).
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
 * The canonical watch URL for a video id.
 *
 * @param {string} videoId
 * @returns {string} `https://www.youtube.com/watch?v=<id>`
 */
export function canonicalYoutubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * If `rawUrl` is a YouTube watch/short video URL, returns its canonical watch URL; otherwise
 * returns `rawUrl` unchanged. Idempotent, safe on non-YouTube URLs.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function toCanonicalYoutubeUrl(rawUrl) {
  const id = youtubeVideoId(rawUrl);
  return id ? canonicalYoutubeWatchUrl(id) : rawUrl;
}

/**
 * If `rawUrl` is a YouTube watch/short video URL, returns the equivalent `youtu.be/<id>` short
 * form; otherwise `null`. Used to recognize a legacy short-form record as the same video during
 * dedup after the canonical-form switch.
 *
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function youtubeShortForm(rawUrl) {
  const id = youtubeVideoId(rawUrl);
  return id ? `https://youtu.be/${id}` : null;
}
