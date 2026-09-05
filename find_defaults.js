const fs = require('fs');
const s = fs.readFileSync('public/app.js', 'utf8');
const lines = s.split('\n');
lines.forEach((l, i) => {
  if (l.includes("header:") && i < 2100) {
    console.log(i + 1, l.trim().slice(0, 100));
  }
});
