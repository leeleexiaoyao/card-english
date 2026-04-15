#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const sentenceBankPath = path.join('miniprogram', 'data', 'sentenceBank.js');
const baseFileID = 'cloud://cloud1-4gsbdd828457096e.636c-cloud1-4gsbdd828457096e-1419193677/cards-v2/card-';

if (!fs.existsSync(sentenceBankPath)) {
  console.error(`sentenceBank file not found: ${sentenceBankPath}`);
  process.exit(1);
}

let content = fs.readFileSync(sentenceBankPath, 'utf8');

// 匹配所有句子的imageUrl字段
const regex = /"imageUrl": "([^"]+)"/g;
let match;
let count = 0;

while ((match = regex.exec(content)) !== null) {
  count++;
  const currentUrl = match[1];
  // 生成对应的cards-v2路径
  const index = String(count).padStart(4, '0');
  const newUrl = `${baseFileID}${index}.jpg`;
  
  // 替换imageUrl
  content = content.replace(match[0], `"imageUrl": "${newUrl}"`);
}

fs.writeFileSync(sentenceBankPath, content, 'utf8');
console.log(`Updated ${count} imageUrl fields to point to cards-v2`);
console.log(`Updated file: ${sentenceBankPath}`);
