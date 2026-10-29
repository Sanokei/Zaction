import test from 'node:test';
import assert from 'node:assert/strict';
import { getForecast, CITY_WEATHER_LOCATIONS } from '../weather.mjs';

const now = new Date('2026-10-29T16:00:00Z');
const date = '2026-10-30';
const dailyBody = (selectedDate = date, overrides = {}) => ({
  daily_units: { temperature_2m_max: '°F', temperature_2m_min: '°F', precipitation_probability_max: '%', wind_speed_10m_max: 'mp/h' },
  daily: { time: [selectedDate], weather_code: [1], temperature_2m_max: [78.2], temperature_2m_min: [63.1], precipitation_probability_max: [20], wind_speed_10m_max: [7.5], ...overrides },
});
const goodResponse = body => ({ ok: true, status: 200, json: async () => body });

test('requests real documented Open-Meteo parameters for the selected public city', async () => {
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return goodResponse(dailyBody()); };
  const result = await getForecast({ cityId: 'new-york', date, now, fetchImpl });
  assert.equal(request.url.origin, 'https://api.open-meteo.com');
  assert.equal(request.url.pathname, '/v1/forecast');
  assert.equal(request.url.searchParams.get('latitude'), '40.7128');
  assert.equal(request.url.searchParams.get('longitude'), '-74.006');
  assert.equal(request.url.searchParams.get('timezone'), 'America/New_York');
  assert.equal(request.url.searchParams.get('forecast_days'), '16');
  assert.equal(request.url.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(request.url.searchParams.get('wind_speed_unit'), 'mph');
  assert.deepEqual(request.url.searchParams.get('daily').split(','), ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'wind_speed_10m_max']);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(result, { status: 'available', cityId: 'new-york', date, sourceUrl: 'https://open-meteo.com/', checkedAt: now.toISOString(), temperatureMaxF: 78.2, temperatureMinF: 63.1, rainChance: 20, windMph: 7.5, description: 'Mainly clear', stale: false });
  assert.equal(Object.keys(CITY_WEATHER_LOCATIONS).length, 5);
});

test('selects the requested day instead of using the first returned forecast', async () => {
  const body = dailyBody();
  body.daily = { time: ['2026-10-29', date], weather_code: [0, 63], temperature_2m_max: [90, 72], temperature_2m_min: [80, 61], precipitation_probability_max: [0, 85], wind_speed_10m_max: [3, 18] };
  const result = await getForecast({ cityId: 'austin', date, now, fetchImpl: async () => goodResponse(body) });
  assert.equal(result.temperatureMaxF, 72);
  assert.equal(result.rainChance, 85);
  assert.equal(result.description, 'Moderate rain');
});

test('rejects unknown cities and invalid or out-of-horizon dates without contacting the provider', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Must not fetch'); };
  const options = [
    { cityId: '__proto__', date }, { cityId: 'unknown', date },
    { cityId: 'new-york', date: '2026-02-30' }, { cityId: 'new-york', date: 'tomorrow' },
    { cityId: 'new-york', date: '2026-10-28' }, { cityId: 'new-york', date: '2026-11-14' },
    { cityId: 'new-york' },
  ];
  for (const option of options) {
    const result = await getForecast({ ...option, now, fetchImpl });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.temperatureMaxF, undefined);
    assert.ok(result.reason);
  }
  assert.equal(calls, 0);
});

test('uses the selected city timezone and includes today through day 15', async () => {
  const midnightUtc = new Date('2026-10-30T01:00:00Z');
  for (const selectedDate of ['2026-10-29', '2026-11-13']) {
    const result = await getForecast({ cityId: 'los-angeles', date: selectedDate, now: midnightUtc, fetchImpl: async () => goodResponse(dailyBody(selectedDate)) });
    assert.equal(result.status, 'available');
  }
  const result = await getForecast({ cityId: 'los-angeles', date: '2026-11-14', now: midnightUtc, fetchImpl: async () => { throw new Error('Must not fetch'); } });
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /2026-10-29 through 2026-11-13/);
});

test('never converts null, missing days, wrong units, or invalid forecast measurements into real weather', async () => {
  const bodies = [dailyBody(date, { precipitation_probability_max: [null] }), dailyBody('2026-10-31'), dailyBody(date, { precipitation_probability_max: [101] }), dailyBody(date, { temperature_2m_min: [100] }), dailyBody(date, { wind_speed_10m_max: [-1] }), dailyBody(date, { weather_code: [999] })];
  const wrongUnits = dailyBody();
  wrongUnits.daily_units.temperature_2m_max = '°C';
  bodies.push(wrongUnits);
  for (const body of bodies) {
    const result = await getForecast({ cityId: 'seattle', date, now, fetchImpl: async () => goodResponse(body) });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.rainChance, undefined);
    assert.match(result.reason, /invalid forecast data/);
  }
});

test('HTTP errors, invalid JSON and network failure return explicit unavailable states', async () => {
  for (const [fetchImpl, reason] of [
    [async () => ({ ok: false, status: 403 }), /HTTP 403/],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }), /unreadable forecast/],
    [async () => { throw new TypeError('network failed'); }, /could not be reached/],
  ]) {
    const result = await getForecast({ cityId: 'chicago', date, now, fetchImpl });
    assert.equal(result.status, 'unavailable');
    assert.match(result.reason, reason);
    assert.equal(result.temperatureMaxF, undefined);
    assert.equal(result.description, undefined);
  }
});

test('fresh results are cached for 30 minutes, returned safely, then refreshed', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return goodResponse(dailyBody(date, { temperature_2m_max: [78 + calls] })); };
  const first = await getForecast({ cityId: 'new-york', date, now, fetchImpl });
  first.temperatureMaxF = 999;
  const cached = await getForecast({ cityId: 'new-york', date, now: new Date(now.getTime() + 29 * 60000), fetchImpl });
  assert.equal(calls, 1);
  assert.equal(cached.temperatureMaxF, 79);
  assert.equal(cached.checkedAt, now.toISOString());
  const refreshed = await getForecast({ cityId: 'new-york', date, now: new Date(now.getTime() + 30 * 60000), fetchImpl });
  assert.equal(calls, 2);
  assert.equal(refreshed.temperatureMaxF, 80);
  assert.equal(refreshed.checkedAt, '2026-10-29T16:30:00.000Z');
});

test('failed refresh exposes stale data only for the same city/date with its original timestamp', async () => {
  let failing = false;
  const fetchImpl = async () => { if (failing) throw new Error('offline'); return goodResponse(dailyBody()); };
  await getForecast({ cityId: 'new-york', date, now, fetchImpl });
  failing = true;
  const later = new Date(now.getTime() + 60 * 60000);
  const stale = await getForecast({ cityId: 'new-york', date, now: later, fetchImpl });
  assert.equal(stale.status, 'available');
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, now.toISOString());
  assert.match(stale.reason, /older forecast/);
  for (const other of [{ cityId: 'austin', date }, { cityId: 'new-york', date: '2026-10-31' }]) {
    const result = await getForecast({ ...other, now: later, fetchImpl });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.temperatureMaxF, undefined);
  }
});

test('a provider that never responds times out and aborts the request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = getForecast({ cityId: 'new-york', date, now, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await Promise.resolve();
  t.mock.timers.tick(8000);
  const result = await pending;
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /timed out/);
  assert.equal(signal.aborted, true);
});

test('the timeout also covers a provider whose response body never finishes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = getForecast({ cityId: 'new-york', date, now, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  await Promise.resolve();
  t.mock.timers.tick(8000);
  const result = await pending;
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /timed out/);
});
