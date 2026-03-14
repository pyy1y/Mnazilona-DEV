export type WeatherState =
  | "clear"
  | "clouds"
  | "rain"
  | "thunder"
  | "snow"
  | "fog"
  | "unknown";

export type WeatherResult = {
  city: string;
  tempC: number;
  feelsLikeC?: number;
  humidity?: number;
  windKph?: number;
  state: WeatherState;
  description: string;
  updatedAt: number;
};

// ✅ Open-Meteo: مجاني بدون API key
export async function fetchWeatherByLatLon(
  lat: number,
  lon: number,
  cityLabel = "Your Area"
): Promise<WeatherResult> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");

  const data = await res.json();
  const cur = data?.current;

  const code = Number(cur?.weather_code);
  const state = mapOpenMeteoCode(code);

  return {
    city: cityLabel,
    tempC: Math.round(cur?.temperature_2m ?? 0),
    feelsLikeC: Math.round(cur?.apparent_temperature ?? 0),
    humidity: Number(cur?.relative_humidity_2m ?? 0),
    windKph: Math.round(Number(cur?.wind_speed_10m ?? 0)),
    state,
    description: describeOpenMeteoCode(code),
    updatedAt: Date.now(),
  };
}

function mapOpenMeteoCode(code: number): WeatherState {
  // https://open-meteo.com/en/docs (weather codes)
  if (code === 0) return "clear";
  if ([1, 2, 3].includes(code)) return "clouds";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunder";
  return "unknown";
}

function describeOpenMeteoCode(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([71, 73, 75].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown";
}

// ======================================
// City -> Lat/Lon (Open-Meteo Geocoding) + Weather by City
// ======================================

type GeocodeResult = {
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
  admin1?: string;
};

async function geocodeCity(city: string): Promise<GeocodeResult> {
  const q = city.trim();
  if (!q) throw new Error('City is empty');

  // Open-Meteo Geocoding (no API key)
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}` +
    `&count=1&language=en&format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');

  const data = await res.json();
  const first = data?.results?.[0];

  if (!first?.latitude || !first?.longitude) {
    throw new Error('City not found');
  }

  return {
    latitude: first.latitude,
    longitude: first.longitude,
    name: first.name,
    country: first.country,
    admin1: first.admin1,
  };
}

// ✅ هذا هو اللي كان ناقص عندك
export async function fetchWeatherByCity(city: string): Promise<WeatherResult> {
  const geo = await geocodeCity(city);

  // نستخدم نفس دالتك الحالية
  // cityLabel يطلع نفس اسم المدينة اللي رجعته خدمة الـ geocoding (أدق)
  return fetchWeatherByLatLon(geo.latitude, geo.longitude, geo.name);
}