const fs = require('fs');
const s = fs.readFileSync('public/app.js', 'utf8');
const lines = s.split('\n');
lines.forEach((l, i) => {
  if (l.includes("carousel:") && i < 1200) {
    console.log(i + 1, l.trim().slice(0, 100));
  }
});
