/* eslint-disable */
import fs from 'fs';
const readFile = (tagName, brandName) => {
  const data = fs.readFileSync(`/Users/dipratap/Documents/reports/audit-csvs/${brandName}/${tagName}.csv`, 'utf8');
  return data;
}

let titleCsv, descriptionCsv, h1Csv;

const init = (brandName) => {
  try {
    titleCsv = readFile('Title', brandName);
    descriptionCsv = readFile('Description', brandName);
    h1Csv = readFile('H1', brandName);
  } catch (err) {
    console.error('Error while reading csv', err);
  }
}

function getFirstNLines(inputString, count, isRandom) {
  let lines = inputString.split('\n');
  if (isRandom) {
    const firstElement = lines[0];
    const restOfArray = lines.slice(1);
    const sortedArray = restOfArray.sort(() => Math.random() - 0.5);
    lines = [firstElement, ...sortedArray];
  }
  const firstNLines = lines.slice(0, count+1);
  return firstNLines.join('\n');
}

export const getH1Csv = (brandName, linesCount, isRandom) => {
  init(brandName);
  if (linesCount) {
    return getFirstNLines(h1Csv, linesCount, isRandom);
  }
  return h1Csv;
}

export const getTitleCsv = (brandName, linesCount, isRandom) => {
  init(brandName);
  if (linesCount) {
    return getFirstNLines(titleCsv, linesCount, isRandom);
  }
  return titleCsv;
}

export const getDescriptionCsv = (brandName, linesCount, isRandom) => {
  init(brandName);
  if (linesCount) {
    return getFirstNLines(descriptionCsv, linesCount, isRandom);
  }
  return descriptionCsv;
}

export const getOneRow = (brandName, tagName, line) => {
  init(brandName);
  let rows;
  if (tagName === 'title') {
    rows = titleCsv.split('\n');
  } else if (tagName === 'description') {
    rows = descriptionCsv.split('\n');
  } else {
    rows = h1Csv.split('\n');
  }
  return `${rows[0]}\n${rows[line - 1]}`;
}