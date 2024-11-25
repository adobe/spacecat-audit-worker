/* eslint-disable */
import fs from "fs";
import path from "path";

const scrapesFolder = '/Users/dipratap/Documents/reports/s3/bulk.com';

const seoRanges = {
  title: { min: 40, max: 60 },
  description: { min: 130, max: 160 },
  h1: { max: 70 }
};

let optimizedTags = {
  title: [],
  description: [],
  h1: []
};

const isSeoOptimized = (tag, minLength, maxLength) => {
  return tag.length >= minLength && tag.length <= maxLength;
};

const processScrapeJsonFiles = (folderPath) => {
  fs.readdirSync(folderPath).forEach(file => {
    const fullPath = path.join(folderPath, file);

    if (fs.lstatSync(fullPath).isDirectory()) {
      processScrapeJsonFiles(fullPath);
    } else if (file === 'scrape.json') {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const { title='', description='', h1='' } = data.scrapeResult.tags;
      if (isSeoOptimized(title, seoRanges.title.min, seoRanges.title.max)) {
        optimizedTags.title.push(title);
      }
      if (isSeoOptimized(description, seoRanges.description.min, seoRanges.description.max)) {
        optimizedTags.description.push(description);
      }
      h1.forEach(tag => {
        if (tag.length > 0 && tag.length <= seoRanges.h1.max) {
          optimizedTags.h1.push(tag);
        }
      });
    }
  });
};

export const run = () => {
  processScrapeJsonFiles(scrapesFolder);
  optimizedTags.title = optimizedTags.title.sort(() => Math.random() - 0.5).slice(0, 30);
  optimizedTags.description = optimizedTags.description.sort(() => Math.random() - 0.5).slice(0, 30);
  optimizedTags.h1 = optimizedTags.h1.slice(0, 30);
  return optimizedTags;
};