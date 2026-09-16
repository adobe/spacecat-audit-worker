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

import { expect } from 'chai';
import { youtubeVideoId } from '../../src/utils/youtube-url.js';

const ID = 'dQw4w9WgXcQ';

describe('youtube-url', () => {
  describe('youtubeVideoId', () => {
    it('extracts the id from watch, youtu.be, www., m., and youtube-nocookie forms', () => {
      expect(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).to.equal(ID);
      expect(youtubeVideoId(`https://youtube.com/watch?v=${ID}`)).to.equal(ID);
      expect(youtubeVideoId(`https://youtu.be/${ID}`)).to.equal(ID);
      expect(youtubeVideoId(`https://m.youtube.com/watch?v=${ID}`)).to.equal(ID);
      expect(youtubeVideoId(`https://www.youtube-nocookie.com/watch?v=${ID}`)).to.equal(ID);
    });

    it('returns the SAME id for the watch and youtu.be forms of one video (dedupe key)', () => {
      expect(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}`))
        .to.equal(youtubeVideoId(`https://youtu.be/${ID}`));
    });

    it('ignores extra query params on a watch URL', () => {
      expect(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=30&list=abc`)).to.equal(ID);
    });

    it('returns null for non-video YouTube URLs (shorts, channels, watch without v, empty short)', () => {
      expect(youtubeVideoId('https://www.youtube.com/shorts/xyz')).to.be.null;
      expect(youtubeVideoId('https://www.youtube.com/@handle')).to.be.null;
      expect(youtubeVideoId('https://www.youtube.com/watch?list=abc')).to.be.null;
      expect(youtubeVideoId('https://youtu.be/')).to.be.null;
    });

    it('returns null for an invalid-character video id', () => {
      expect(youtubeVideoId('https://www.youtube.com/watch?v=bad*id')).to.be.null;
    });

    it('returns null for non-YouTube or unparseable URLs', () => {
      expect(youtubeVideoId(`https://example.com/watch?v=${ID}`)).to.be.null;
      expect(youtubeVideoId('https://www.reddit.com/r/x/comments/1/post')).to.be.null;
      expect(youtubeVideoId('not a url')).to.be.null;
    });
  });
});
