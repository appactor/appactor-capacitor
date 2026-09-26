export type JsonObject = Record<string, unknown>;
export type JsonMap<T> = Record<string, T>;

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isIterable(value: unknown): value is Iterable<unknown> {
  return value != null && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

/**
 * UTF-8 byte count, computed by hand: `TextEncoder` is missing from some test environments (jsdom)
 * that import this package. A lone surrogate counts 3 bytes, as the encoder's replacement character.
 */
export function byteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(value.charCodeAt(index + 1))) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Own-property lookup, so keys like `constructor` or `toString` don't reach `Object.prototype`. */
export function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/**
 * `Object.fromEntries` without needing ES2019: Capacitor 8 still runs on Android WebViews older than Chrome 73.
 * Defines own properties like the original, so a `__proto__` key stays data.
 */
export function fromEntries<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const record: Record<string, T> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return record;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  const numberValue = asNumber(value);
  return numberValue == null ? undefined : Math.trunc(numberValue);
}

export function ensureRecord(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

export function requireRecord(value: unknown, fieldName: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return value;
}

export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }
  return value;
}

export function optionalString(value: unknown, fieldName: string): string | undefined {
  return value == null ? undefined : requireString(value, fieldName);
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }
  return value;
}

export function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  return value == null ? undefined : requireBoolean(value, fieldName);
}

export function requireInteger(value: unknown, fieldName: string): number {
  const integerValue = asInteger(value);
  if (integerValue == null) {
    throw new Error(`${fieldName} must be a number.`);
  }
  return integerValue;
}

export function optionalInteger(value: unknown, fieldName: string): number | undefined {
  return value == null ? undefined : requireInteger(value, fieldName);
}

function requireNumber(value: unknown, fieldName: string): number {
  const numberValue = asNumber(value);
  if (numberValue == null) {
    throw new Error(`${fieldName} must be a number.`);
  }
  return numberValue;
}

export function optionalNumber(value: unknown, fieldName: string): number | undefined {
  return value == null ? undefined : requireNumber(value, fieldName);
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value;
}

export function optionalStringArray(value: unknown, fieldName: string): string[] {
  return value == null
    ? []
    : requireArray(value, fieldName).map((item, index) => requireString(item, `${fieldName}[${index}]`));
}

/** Lenient: anything but an array reads as empty. */
export function asStringArray(value: unknown, fieldName: string): string[] {
  return Array.isArray(value) ? value.map((item, index) => requireString(item, `${fieldName}[${index}]`)) : [];
}

/** Lenient like `asStringArray`, for a list of nested models. */
export function asObjectArray<T>(value: unknown, fieldName: string, decode: (json: JsonObject) => T): T[] {
  return Array.isArray(value) ? value.map((item) => decode(requireRecord(item, `${fieldName}[]`))) : [];
}

/** A string enum field: `undefined` when absent, parsed when a string, rejected otherwise. */
export function optionalEnum<T>(value: unknown, fieldName: string, parse: (value: string) => T): T | undefined {
  return value == null ? undefined : parse(requireString(value, fieldName));
}

/** A nested model: `undefined` when absent, decoded when an object, rejected otherwise. */
export function optionalObject<T>(value: unknown, fieldName: string, decode: (json: JsonObject) => T): T | undefined {
  return value == null ? undefined : decode(requireRecord(value, fieldName));
}

function mapEntries<T>(record: JsonObject, map: (item: unknown, key: string) => T): JsonMap<T> {
  return fromEntries(Object.entries(record).map(([key, item]) => [key, map(item, key)] as const));
}

/** A record whose `fieldName.key` items `requireItem` checks; `undefined` when absent. */
export function optionalRecordOf<T>(
  value: unknown,
  fieldName: string,
  requireItem: (item: unknown, itemName: string) => T,
): JsonMap<T> | undefined {
  return value == null
    ? undefined
    : mapEntries(requireRecord(value, fieldName), (item, key) => requireItem(item, `${fieldName}.${key}`));
}

export function mapValues<T>(value: unknown, mapper: (entry: JsonObject) => T): JsonMap<T> {
  return isRecord(value) ? mapEntries(value, (item, key) => mapper(requireRecord(item, key))) : {};
}

export function mapListValues<T>(value: unknown, mapper: (entry: JsonObject) => T): JsonMap<T[]> {
  return isRecord(value)
    ? mapEntries(value, (item, key) =>
        requireArray(item, key).map((entry, index) => mapper(requireRecord(entry, `${key}[${index}]`))),
      )
    : {};
}

export function mapStringLists(value: unknown): JsonMap<string[]> {
  return value == null
    ? {}
    : mapEntries(requireRecord(value, 'value'), (item, key) =>
        requireArray(item, key).map((entry, index) => requireString(entry, `${key}[${index}]`)),
      );
}

/** Locale-independent order: a locale-aware compare can tie distinct strings and make equality order-dependent. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeForEquality(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Set) {
    return Array.from(value)
      .map((item) => normalizeForEquality(item, seen))
      .sort((left, right) => compareCodeUnits(JSON.stringify(left) ?? '', JSON.stringify(right) ?? ''));
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForEquality(item, seen));
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const normalized = fromEntries(
      Object.entries(value)
        .filter(([, item]) => typeof item !== 'function')
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, item]) => [key, normalizeForEquality(item, seen)]),
    );
    seen.delete(value);
    return normalized;
  }
  return value;
}

/** Structural equality for AppActor models: key order, `Set` order and `Date` identity don't matter. */
export function appActorModelEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeForEquality(left)) === JSON.stringify(normalizeForEquality(right));
}
