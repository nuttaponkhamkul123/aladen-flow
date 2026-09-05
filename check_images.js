const https = require('https');

const urls = [
  "https://static.vecteezy.com/system/resources/thumbnails/050/393/628/small/cute-curious-gray-and-white-kitten-in-a-long-shot-photo.jpg",
  "https://images.ctfassets.net/ub3bwfd53mwy/5WFv6lEUb1e6kWeP06CLXr/acd328417f24786af98b1750d90813de/4_Image.jpg?w=750",
  "https://plus.unsplash.com/premium_photo-1667030474693-6d0632f97029?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8Y2F0fGVufDB8fDB8fHww"
];

urls.forEach((url, i) => {
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    console.log(`URL ${i}: status = ${res.statusCode}, content-type = ${res.headers['content-type']}`);
  }).on('error', (e) => {
    console.log(`URL ${i}: error = ${e.message}`);
  });
});
