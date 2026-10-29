/**
 * Public city-level daily forecasts, not a prediction for an exact park or event time.
 * Open-Meteo schema checked at source revision
 * e29ee554151b43076ae32724028eea9cdefab7c4 (openapi/forecast.yml).
 * Data attribution: https://open-meteo.com/ — CC BY 4.0.
 */
export const WEATHER_SOURCE_URL = 'https://open-meteo.com/';
export const CITY_WEATHER_LOCATIONS = Object.freeze({
  'new-york': Object.freeze({ name: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' }),
  austin: Object.freeze({ name: 'Austin', latitude: 30.2672, longitude: -97.7431, timezone: 'America/Chicago' }),
  seattle: Object.freeze({ name: 'Seattle', latitude: 47.6062, longitude: -122.3321, timezone: 'America/Los_Angeles' }),
  chicago: Object.freeze({ name: 'Chicago', latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago' }),
  'los-angeles': Object.freeze({ name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437, timezone: 'America/Los_Angeles' }),
});

const CACHE_DURATION_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 160;
// Separate injected transports keep tests isolated without clearing production caches.
const providerCaches = new WeakMap();
const WEATHER_DESCRIPTIONS = new Map([
  [0, 'Clear sky'], [1, 'Mainly clear'], [2, 'Partly cloudy'], [3, 'Overcast'],
  [45, 'Fog'], [48, 'Depositing rime fog'], [51, 'Light drizzle'], [53, 'Moderate drizzle'],
  [55, 'Dense drizzle'], [56, 'Light freezing drizzle'], [57, 'Dense freezing drizzle'],
  [61, 'Slight rain'], [63, 'Moderate rain'], [65, 'Heavy rain'], [66, 'Light freezing rain'],
  [67, 'Heavy freezing rain'], [71, 'Slight snowfall'], [73, 'Moderate snowfall'],
  [75, 'Heavy snowfall'], [77, 'Snow grains'], [80, 'Slight rain showers'],
  [81, 'Moderate rain showers'], [82, 'Violent rain showers'], [85, 'Slight snow showers'],
  [86, 'Heavy snow showers'], [95, 'Thunderstorm'], [96, 'Thunderstorm with slight hail'],
  [99, 'Thunderstorm with heavy hail'],
]);

function localDate(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = name => parts.find(item => item.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(date, count) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
}

class ForecastError extends Error {}

async function requestForecast(url, fetchImpl) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ForecastError('The weather request timed out. Try again later.'));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
        if (!response?.ok) {
          const status = Number.isInteger(response?.status) ? ` (HTTP ${response.status})` : '';
          throw new ForecastError(`The weather provider is unavailable${status}. Try again later.`);
        }
        try { return await response.json(); }
        catch { throw new ForecastError('The weather provider returned an unreadable forecast. Try again later.'); }
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function readDailyForecast(body, date) {
  const daily = body?.daily;
  const units = body?.daily_units;
  const index = Array.isArray(daily?.time) ? daily.time.indexOf(date) : -1;
  const value = key => Array.isArray(daily?.[key]) ? daily[key][index] : undefined;
  const temperatureMaxF = value('temperature_2m_max');
  const temperatureMinF = value('temperature_2m_min');
  const rainChance = value('precipitation_probability_max');
  const windMph = value('wind_speed_10m_max');
  const code = value('weather_code');
  if (index < 0 || !units || units.temperature_2m_max !== '°F' || units.temperature_2m_min !== '°F'
      || units.precipitation_probability_max !== '%' || !['mp/h', 'mph'].includes(units.wind_speed_10m_max)
      || ![temperatureMaxF, temperatureMinF, rainChance, windMph].every(item => typeof item === 'number' && Number.isFinite(item))
      || temperatureMinF > temperatureMaxF || rainChance < 0 || rainChance > 100 || windMph < 0
      || !WEATHER_DESCRIPTIONS.has(code)) {
    throw new ForecastError('The weather provider returned incomplete or invalid forecast data. Try again later.');
  }
  return { temperatureMaxF, temperatureMinF, rainChance, windMph, description: WEATHER_DESCRIPTIONS.get(code) };
}

/**
 * @param {{cityId?: string, date?: string, fetchImpl?: typeof fetch, now?: Date}} options
 * @returns {Promise<object>} Discriminated available/unavailable result; unavailable has no invented measurements.
 */
export async function getForecast({ cityId, date, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const identity = { cityId: typeof cityId === 'string' ? cityId : '', date: typeof date === 'string' ? date : '', sourceUrl: WEATHER_SOURCE_URL };
  const unavailable = reason => ({ status: 'unavailable', ...identity, reason });
  if (!Object.hasOwn(CITY_WEATHER_LOCATIONS, identity.cityId)) return unavailable('Choose one of the supported cities to check the weather.');
  if (!validDate(identity.date)) return unavailable('Choose a valid date in YYYY-MM-DD format to check the weather.');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return unavailable('The current date could not be determined. Try again later.');
  const location = CITY_WEATHER_LOCATIONS[identity.cityId];
  const today = localDate(now, location.timezone);
  const lastForecastDate = addDays(today, 15);
  if (identity.date < today || identity.date > lastForecastDate) {
    return unavailable(`Weather forecasts for ${location.name} are available from ${today} through ${lastForecastDate}. Choose a date in that range.`);
  }
  if (typeof fetchImpl !== 'function') return unavailable('Weather requests are not supported by this server.');
  let cache = providerCaches.get(fetchImpl);
  if (!cache) { cache = new Map(); providerCaches.set(fetchImpl, cache); }
  const key = `${identity.cityId}:${identity.date}`;
  const cached = cache.get(key);
  const elapsed = cached ? now.getTime() - cached.checkedAtMs : Infinity;
  if (cached && elapsed >= 0 && elapsed < CACHE_DURATION_MS) return { ...cached.result };

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: location.timezone, forecast_days: '16',
  }).toString();
  try {
    const body = await requestForecast(url, fetchImpl);
    const forecast = readDailyForecast(body, identity.date);
    const result = { status: 'available', ...identity, checkedAt: now.toISOString(), ...forecast, stale: false };
    if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { checkedAtMs: now.getTime(), result });
    return { ...result };
  } catch (error) {
    const reason = error instanceof ForecastError ? error.message : 'The weather provider could not be reached. Try again later.';
    if (cached && elapsed >= 0) return { ...cached.result, stale: true, reason: `${reason} Showing an older forecast; check its timestamp before planning.` };
    return unavailable(reason);
  }
}
