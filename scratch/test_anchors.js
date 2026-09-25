const http = require('http');

http.get('http://localhost:3456/p/aladen-studio', res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('craft:', body.includes('id="craft"'));
    console.log('capabilities:', body.includes('id="capabilities"'));
    console.log('perspective:', body.includes('id="perspective"'));
    console.log('pricing:', body.includes('id="pricing"'));
    console.log('scroll-margin-top:', body.includes('scroll-margin-top: 88px'));
  });
}).on('error', err => console.error(err.message));
