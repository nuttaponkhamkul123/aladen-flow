const http = require('http');
const fs = require('fs');

const s = fs.readFileSync('server.js', 'utf8');
const lines = s.split('\n');
lines.forEach((l, i) => {
  if (l.includes("app.get(") || l.includes("app.post(")) {
    console.log(i + 1, l.trim().slice(0, 100));
  }
});
