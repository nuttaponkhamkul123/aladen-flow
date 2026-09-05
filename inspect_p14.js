const db = require('./db');
const p14 = db.prepare('SELECT id, title, slug, is_first_page, blocks FROM pages WHERE id = 14').get();
console.log('Page 14:', p14.title, p14.slug, 'first:', p14.is_first_page);
const blocks = JSON.parse(p14.blocks);
console.log('Total blocks:', blocks.length);
blocks.forEach((b, i) => {
  console.log(`[${i}] id=${b.id} type=${b.type} parent=${b.parentId || 'root'}`);
  if (b.type === 'carousel') {
    console.log('   carousel props:', JSON.stringify(b.props));
  }
  if (b.type === 'header') {
    console.log('   header props:', JSON.stringify(b.props));
  }
});
