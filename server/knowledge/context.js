'use strict';

// データを文章命令として組み立てず、固定の小さなJSON形式として渡す。
function knowledgeContext(items) {
  let remainingBytes = 3000;
  const selected = [];
  for (const item of items.slice(0, 4)) {
    const entry = { category:item.category.slice(0, 40), title:item.title.slice(0, 120),
      body:item.body.slice(0, 500), source:item.source.slice(0, 120) };
    const size = Buffer.byteLength(JSON.stringify(entry), 'utf8');
    if (size > remainingBytes) break;
    selected.push(entry);
    remainingBytes -= size;
  }
  return selected;
}

module.exports = { knowledgeContext };
