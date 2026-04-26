import AsyncStorage from '@react-native-async-storage/async-storage';

export type TemperatureUnit = 'Celsius' | 'Fahrenheit';

export interface AppPreferences {
  temperatureUnit: TemperatureUnit;
}

const PREFS_KEY = 'mnazilona_preferences';

export const DEFAULT_PREFERENCES: AppPreferences = {
  temperatureUnit: 'Celsius',
};

function isTemperatureUnit(value: unknown): value is TemperatureUnit {
  return value === 'Celsius' || value === 'Fahrenheit';
}

export async function loadPreferences(): Promise<AppPreferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    return {
      temperatureUnit: isTemperatureUnit(parsed.temperatureUnit)
        ? parsed.temperatureUnit
        : DEFAULT_PREFERENCES.temperatureUnit,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreferences(
  preferences: AppPreferences
): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
  } catch {
    if (__DEV__) console.error('Failed to save preferences');
  }
}

export function convertTemperature(
  valueCelsius: number,
  unit: TemperatureUnit
): number {
  if (unit === 'Fahrenheit') {
    return (valueCelsius * 9) / 5 + 32;
  }
  return valueCelsius;
}

export function getTemperatureUnitSymbol(unit: TemperatureUnit): 'C' | 'F' {
  return unit === 'Fahrenheit' ? 'F' : 'C';
}
