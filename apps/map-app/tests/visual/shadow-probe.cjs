/* Playwright probe for the shadow catcher. Run against the dev server. */
const { chromium } = require('@playwright/test');
const fs = require('fs');

const URL = 'http://127.0.0.1:5199/?shadowDebug=1';
const PROBE_PITCH = Number(process.env.PROBE_PITCH ?? 0);

async function main() {
  const browser = await chromium.launch({
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/chromium-libs/extracted/usr/lib/x86_64-linux-gnu' },
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (error) => console.log('[pageerror]', String(error).slice(0, 400)));

  await page.addInitScript((pitch) => {
    localStorage.setItem('maps-viewport-v1', JSON.stringify({
      center: [23.7609, 61.4981], zoom: 15.5, bearing: 0, pitch,
    }));
  }, PROBE_PITCH);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const probe = async (label) => {
    const state = await page.evaluate(() => {
      const layer = window.katuShadowDebug?.layer?.();
      if (!layer) return { missing: true };
      const stats = layer.getPerformanceStats();
      return { stats, zoom: layer['map']?.getZoom?.() };
    });
    const summary = state.stats
      ? `active=${state.stats.active} groundCommits=${state.stats.groundCommits} buildingCommits=${state.stats.buildingCommits} visibleProxies=${state.stats.visibleProxyCount}/${state.stats.proxyCount} lastGroundMs=${Math.round(state.stats.lastGroundJobMs)} lastBuildingMs=${Math.round(state.stats.lastBuildingJobMs)}`
      : JSON.stringify(state);
    console.log(label, summary);
  };

  await probe('t=1.5s');
  await page.waitForTimeout(4000);
  await probe('t=5.5s');
  await page.waitForTimeout(4000);
  await probe('t=9.5s');
  await page.waitForTimeout(8000);
  await probe('t=17.5s');

  const shotWith = await page.screenshot();
  await page.evaluate(() => {
    window.katuShadowDebug.layer()['map'].setLayoutProperty('ground-shadow-catcher-3d', 'visibility', 'none');
  });
  await page.waitForTimeout(800);
  const shotWithout = await page.screenshot();
  await page.evaluate(() => {
    window.katuShadowDebug.layer()['map'].setLayoutProperty('ground-shadow-catcher-3d', 'visibility', 'visible');
  });

  // Per-pixel analysis: is the catcher's contribution patchy shadows or a wash?
  const analysis = await page.evaluate(async ({ withData, withoutData }) => {
    const load = (data) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.src = 'data:image/png;base64,' + data;
    });
    const withImage = await load(withData);
    const withoutImage = await load(withoutData);
    const canvas = document.createElement('canvas');
    canvas.width = withImage.width;
    canvas.height = withImage.height;
    const context = canvas.getContext('2d');
    context.drawImage(withImage, 0, 0);
    const withPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(withoutImage, 0, 0);
    const withoutPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkened = 0;
    let lightened = 0;
    let total = 0;
    let darkSum = 0;
    const buckets = new Array(8).fill(0);
    let darkRows = new Array(8).fill(0);
    for (let y = 0; y < canvas.height; y += 2) {
      let rowDark = 0;
      for (let x = 0; x < canvas.width; x += 2) {
        const index = (y * canvas.width + x) * 4;
        const lumWith = (withPixels[index] + withPixels[index + 1] + withPixels[index + 2]) / 3;
        const lumWithout = (withoutPixels[index] + withoutPixels[index + 1] + withoutPixels[index + 2]) / 3;
        const delta = lumWith - lumWithout;
        total += 1;
        if (delta > 10) {
          darkened += 1;
          rowDark += 1;
          darkSum += delta;
          buckets[Math.min(7, Math.floor(delta / 12))] += 1;
        } else if (delta < -10) {
          lightened += 1;
        }
      }
      darkRows[Math.floor(y / canvas.height * 8)] += rowDark;
    }
    return {
      sampled: total,
      darkenedPct: (100 * darkened / total).toFixed(2),
      lightenedPct: (100 * lightened / total).toFixed(2),
      avgDarkening: darkened ? (darkSum / darkened).toFixed(1) : '0',
      intensityBuckets: buckets,
      darkRowsByEighth: darkRows.map((value) => Math.round(value)),
    };
  }, { withData: shotWith.toString('base64'), withoutData: shotWithout.toString('base64') });
  console.log('PIXEL ANALYSIS', JSON.stringify(analysis, null, 1));
  // Shadow-mask visualization: a red ShadowMaterial paints red wherever the
  // mask says "shadowed" - distinguishes empty shadow map from acne.
  await page.evaluate(() => {
    const material = window.katuShadowDebug.layer()['groundMaterial'];
    material.color.set(0xff0000);
    material.opacity = 0.9;
    window.katuShadowDebug.layer()['map'].triggerRepaint();
  });
  await page.waitForTimeout(700);
  const shotRedMask = await page.screenshot();
  await page.evaluate(() => {
    const material = window.katuShadowDebug.layer()['groundMaterial'];
    material.color.set(0x4b5d52);
    material.opacity = 0.28;
    window.katuShadowDebug.layer()['map'].triggerRepaint();
  });
  const maskAnalysis = await page.evaluate(async ({ redData, baseData }) => {
    const load = (data) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.src = 'data:image/png;base64,' + data;
    });
    const redImage = await load(redData);
    const baseImage = await load(baseData);
    const canvas = document.createElement('canvas');
    canvas.width = redImage.width;
    canvas.height = redImage.height;
    const context = canvas.getContext('2d');
    context.drawImage(redImage, 0, 0);
    const redPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(baseImage, 0, 0);
    const basePixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let redMask = 0;
    let total = 0;
    let changed = 0;
    for (let index = 0; index < redPixels.length; index += 8) {
      total += 1;
      const redness = redPixels[index] - Math.max(redPixels[index + 1], redPixels[index + 2]);
      const baseRedness = basePixels[index] - Math.max(basePixels[index + 1], basePixels[index + 2]);
      if (redness - baseRedness > 40) redMask += 1;
      if (Math.abs(redPixels[index] - basePixels[index]) + Math.abs(redPixels[index + 1] - basePixels[index + 1]) > 24) changed += 1;
    }
    return {
      total,
      redMaskPct: (100 * redMask / total).toFixed(2),
      changedPct: (100 * changed / total).toFixed(2),
    };
  }, { redData: shotRedMask.toString('base64'), baseData: shotWithout.toString('base64') });
  console.log('RED MASK ANALYSIS', JSON.stringify(maskAnalysis));
  fs.writeFileSync(`/tmp/katu-red-mask-${PROBE_PITCH}.png`, shotRedMask);

  fs.writeFileSync(`/tmp/katu-with-shadows-${PROBE_PITCH}.png`, shotWith);
  fs.writeFileSync(`/tmp/katu-without-shadows-${PROBE_PITCH}.png`, shotWithout);
  await browser.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
