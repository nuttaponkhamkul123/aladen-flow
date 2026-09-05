const http = require('http');

http.get('http://localhost:3456/p', (res) => {
  console.log('Status /p:', res.statusCode, res.headers.location);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('HTML length /p:', data.length);
    if (data.includes('cms-carousel')) {
      console.log('Found cms-carousel in /p!');
    }
  });
});
