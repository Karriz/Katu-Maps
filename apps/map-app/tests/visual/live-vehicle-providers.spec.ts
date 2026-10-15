import { expect, test } from '@playwright/test';
import mqttPacket from 'mqtt-packet';
import { installVisualProviderFixtures } from './provider-fixtures';

test.use({ actionTimeout: 10_000 });

for (const provider of ['foli', 'digitraffic', 'hsl'] as const) {
  test(`live fleet provider ${provider}: feed, selection, stops and shutdown`, async ({ page }) => {
    const center = provider === 'foli' ? [22.267, 60.451] : provider === 'hsl' ? [24.94, 60.17] : [23.7609, 61.4981];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await installVisualProviderFixtures(page);
    let brokerClosed = false;
    if (provider === 'hsl') {
      await page.routeWebSocket('wss://mqtt.hsl.fi/**', socket => {
        const parser = mqttPacket.parser();
        parser.on('packet', packet => {
          if (packet.cmd === 'connect') socket.send(mqttPacket.generate({ cmd: 'connack', sessionPresent: false, returnCode: 0 }));
          if (packet.cmd === 'subscribe') {
            socket.send(mqttPacket.generate({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 0) }));
            socket.send(mqttPacket.generate({ cmd: 'publish', qos: 0, dup: false, retain: false,
              topic: '/hfp/v2/journey/ongoing/vp/tram/6/42/1001/1/Center/1200/1234/0/abcd',
              payload: JSON.stringify({ VP: { oper: 6, veh: 42, desi: '1', route: '1001',
                long: center[0], lat: center[1], tst: Date.now() / 1000, hdg: 90,
                oday: new Date().toISOString().slice(0, 10), dir: 1, start: '12:00', dest: 'Fixture terminus' } }),
            }));
          }
          if (packet.cmd === 'pingreq') socket.send(mqttPacket.generate({ cmd: 'pingresp' }));
        });
        socket.onMessage(data => parser.parse(typeof data === 'string' ? Buffer.from(data) : data));
        socket.onClose(() => { brokerClosed = true; });
      });
    }
    await page.route('https://data.itsfactory.fi/**', route => route.fulfill({ json: {} }));
    await page.route('https://data.foli.fi/**', route => route.fulfill({ json: { result: { vehicles: { bus: {
      longitude: center[0], latitude: center[1], recordedattime: Date.now() / 1000,
      publishedlinename: '6', destinationname: 'Fixture terminus', bearing: 90,
      onwardcalls: [{ stoppointname: 'Fixture origin' }, { stoppointname: 'Fixture terminus' }],
    } } } } }));
    await page.route('https://rata.digitraffic.fi/**', route => {
      const url = route.request().url();
      if (provider !== 'digitraffic') return route.fulfill({ json: { data: { currentlyRunningTrains: [] } } });
      if (url.includes('graphql')) return route.fulfill({ json: { data: { currentlyRunningTrains: [{
        trainNumber: 9, departureDate: new Date().toISOString().slice(0, 10), commuterLineid: 'R',
        trainType: { name: 'HL', trainCategory: { name: 'Commuter' } },
      }] } } });
      if (url.includes('train-locations')) return route.fulfill({ json: { features: [{
        geometry: { type: 'Point', coordinates: center }, properties: { trainNumber: 9,
          departureDate: new Date().toISOString().slice(0, 10), timestamp: new Date().toISOString(), isGpsLocation: true, speed: 0 },
      }] } });
      if (url.includes('metadata/stations')) return route.fulfill({ json: [
        { stationShortCode: 'A', stationName: 'Fixture origin' }, { stationShortCode: 'B', stationName: 'Fixture terminus' },
      ] });
      return route.fulfill({ json: [{ timeTableRows: [
        { stationShortCode: 'A', commercialStop: true, scheduledTime: new Date().toISOString() },
        { stationShortCode: 'B', commercialStop: true, scheduledTime: new Date(Date.now() + 300_000).toISOString() },
      ] }] });
    });
    await page.route('https://api.digitransit.fi/routing/v2/finland/gtfs/v1**', async route => {
      const query = route.request().postDataJSON().query as string;
      if (!query.includes('LiveFuzzyTrip') && !query.includes('LiveTripById')) return route.fallback();
      const trip = { gtfsId: provider === 'digitraffic' ? `digitraffic:9_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}` : 'HSL:fixture',
        onServiceDate: { stopCalls: ['Fixture origin', 'Fixture terminus'].map(name => ({ stopLocation: { name } })) } };
      return route.fulfill({ json: { data: query.includes('LiveFuzzyTrip') ? { fuzzyTrip: trip } : { trip } } });
    });
    await page.addInitScript(({ center }) => {
      localStorage.clear();
      localStorage.setItem('tampere-map-layer-options', JSON.stringify({ globe: false, trees: false,
        buildings: true, bridges: false, terrain: false, transit: false, transitModels: false, liveVehicles: true }));
      localStorage.setItem('maps-viewport-v1', JSON.stringify({ center, zoom: 16, bearing: 0, pitch: 0 }));
    }, { center });
    await page.goto('/');
    await expect(page.locator('.map-status')).toBeHidden({ timeout: 45_000 });
    const panel = page.locator('.live-vehicle-panel');
    await expect(async () => {
      await page.locator('.maplibregl-canvas').click({ position: { x: 720, y: 450 } });
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(panel.locator('.transit-route-badge')).toHaveText(provider === 'foli' ? '6' : provider === 'hsl' ? '1' : 'R');
    await expect(panel.locator('.transit-route-stop')).toHaveCount(2);
    await page.getByRole('button', { name: 'Map layers', exact: true }).click();
    const layers = page.locator('#map-layer-panel');
    const transit = layers.locator('details.layer-group').filter({ hasText: 'Transit stops' });
    if (await transit.getAttribute('open') === null) await transit.locator('summary').click();
    await layers.getByRole('switch', { name: /^Live vehicles/ }).click();
    await expect(panel).toBeHidden();
    if (provider === 'hsl') await expect.poll(() => brokerClosed).toBe(true);
    expect(errors).toEqual([]);
  });
}
