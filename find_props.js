const fs = require('fs');
const s = fs.readFileSync('public/app.js', 'utf8');
const lines = s.split('\n');
lines.forEach((l, i) => {
  if (l.includes("case 'header':") || l.includes("case 'carousel':")) {
    console.log(i + 1, l.trim());
  }
});
