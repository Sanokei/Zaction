import { getForecast } from '../weather.mjs';

// A real-provider check. No fixtures or fallback measurements are used here.
const now = new Date();
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(now);
const part = name => parts.find(value => value.type === name).value;
const today = `${part('year')}-${part('month')}-${part('day')}`;
const date = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const result = await getForecast({ cityId: 'new-york', date, now });
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'available' || result.stale) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log('::warning title=Live weather check::No current forecast was verified. The weather UI must keep its unavailable state; fixture tests are separate.');
  console.error('Live weather check failed: no current provider forecast was verified.');
  if ((process.env.HTTPS_PROXY || process.env.HTTP_PROXY) && process.env.NODE_USE_ENV_PROXY !== '1' && !process.execArgv.includes('--use-env-proxy')) {
    console.error('This Node.js runtime supports proxies with NODE_USE_ENV_PROXY=1 or --use-env-proxy.');
  }
  process.exitCode = 1;
} else if (process.env.GITHUB_ACTIONS === 'true') console.log('::notice title=Live weather check::A current Open-Meteo city forecast was verified. This is separate from the controlled UI forecast tests.');
