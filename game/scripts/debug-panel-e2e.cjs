// Start Vite on :5199, then PW=<playwright-core> node scripts/debug-panel-e2e.cjs.
// BROWSER=webkit checks Safari; Chromium uses real touch input through CDP.
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PW || 'playwright-core');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const safari = process.env.BROWSER === 'webkit';
  const browser = await (safari ? webkit : chromium).launch({ headless: true,
    ...(!safari && process.env.EXE ? { executablePath: process.env.EXE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5199/');
    await page.locator('[data-act=start]').click();
    await page.locator('[data-go]').click();
    const go = page.locator('.go:not([hidden])');
    await go.waitFor({ timeout: 120000 });
    await wait(700); // let the camera finish centring after the landing animation
    const before = await page.evaluate(() => {
      const g = window.__rich4.game;
      return { current: g.current, day: g.daysElapsed, cash: g.players.map(p => p.cash) };
    });
    const cdp = safari ? null : await context.newCDPSession(page);
    const down = async (x, y) => cdp
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      : (await page.mouse.move(x, y), page.mouse.down());
    const move = async (x, y) => cdp
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      : page.mouse.move(x, y);
    const up = () => cdp
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      : page.mouse.up();
    const frame = async () => {
      const b = await go.boundingBox();
      // The lower left frame is away from the buttons, so mobile touch-target adjustment cannot pick GO.
      const point = { x: b.x + b.width * 0.15, y: b.y + b.height * 0.9 };
      assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.className, point), 'go-face');
      return point;
    };
    const closed = async () => assert.equal(await page.locator('.dbg-panel').count(), 0);
    let p = await frame();
    await down(p.x, p.y); await up(); await wait(1100); await closed();
    console.log('PASS short frame tap does not open DEBUG');

    p = await frame();
    await down(p.x, p.y); await move(p.x + 24, p.y); await wait(1100); await up(); await closed();
    console.log('PASS dragging cancels long press');

    if (cdp) {
      p = await frame();
      await down(p.x, p.y);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await wait(1100); await closed();
      console.log('PASS cancelled touch does not open DEBUG');
    }

    p = await frame();
    await down(p.x, p.y); await page.locator('.dbg-panel').waitFor({ timeout: 2500 }); await up();
    assert.ok(await go.isVisible());
    assert.deepEqual(await page.evaluate(() => {
      const g = window.__rich4.game;
      return { current: g.current, day: g.daysElapsed, cash: g.players.map(p => p.cash) };
    }), before);
    console.log('PASS holding frame opens DEBUG without rolling');

    const human = await page.evaluate(() => window.__rich4.game.players.find(p => p.whoPlays === 1 && !p.bankrupt).id);
    for (let i = 1; i <= 3; i++) {
      await page.locator('[data-act="cash+"][data-p="0"]').click();
      assert.equal(await page.evaluate(id => window.__rich4.game.players[id].cash, human), before.cash[human] + i * 100000);
    }
    console.log('PASS repeated panel actions each apply exactly once');
    await page.locator('.dbg-close').click(); await closed();

    p = await frame();
    for (let i = 0; i < 5; i++) { await down(p.x, p.y); await up(); }
    await page.locator('.dbg-panel').waitFor({ timeout: 1000 });
    await page.locator('.dbg-close').click(); await closed();
    console.log('PASS five frame taps still open DEBUG');

    const hit = await page.locator('.go-hit').boundingBox();
    await down(hit.x + hit.width / 2, hit.y + hit.height / 2); await up();
    assert.equal(await page.locator('.go').getAttribute('hidden'), '');
    await closed();
    console.log('PASS tapping GO centre still departs');
    assert.deepEqual(errors, []);
    console.log(`PASS ${safari ? 'WebKit' : 'Chromium touch'}: no page errors`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
