const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await p.goto('file://' + process.cwd() + '/tools/out/card-preview.html');
  const secs = await p.$$('section');
  for (let i = 0; i < secs.length; i++) await secs[i].screenshot({ path: `tools/out/shot-${i}.png` });
  await b.close();
})();
