export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function numberField(
  object: JsonObject,
  key: string,
): number | undefined {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function stringField(
  object: JsonObject,
  key: string,
): string | undefined {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

export function parseJsonObject(line: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(line);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}
