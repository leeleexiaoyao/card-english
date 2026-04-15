#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const mappingPath = process.argv[2] || path.join('scripts', 'card-fileids.json');
const sentenceBankPath = process.argv[3] || path.join('miniprogram', 'data', 'sentenceBank.js');

if (!fs.existsSync(mappingPath)) {
  console.error(`mapping file not found: ${mappingPath}`);
  process.exit(1);
}
if (!fs.existsSync(sentenceBankPath)) {
  console.error(`sentenceBank file not found: ${sentenceBankPath}`);
  process.exit(1);
}

const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
let content = fs.readFileSync(sentenceBankPath, 'utf8');

for (const [sentenceId, item] of Object.entries(mapping)) {
  const fileID = item && item.fileID;
  if (!fileID) {
    continue;
  }

  const escapedId = sentenceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockPattern = new RegExp(`(\\"_id\\": \\\"${escapedId}\\\"[\\s\\S]*?\\"imageUrl\\": \\\")([^\\\"]+)(\\\")`, 'm');
  if (blockPattern.test(content)) {
    content = content.replace(blockPattern, `$1${fileID}$3`);
  }
}

fs.writeFileSync(sentenceBankPath, content, 'utf8');
console.log(`updated: ${sentenceBankPath}`);
