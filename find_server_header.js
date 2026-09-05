const fs = require('fs');
const s = fs.readFileSync('server.js', 'utf8');
const lines = s.split('\n');
lines.forEach((l, i) => {
  if (l.includes("case 'header':") || l.includes("cms-header-carousel")) {
    console.log(i + 1, l.trim().slice(0, 100));
  }
});
