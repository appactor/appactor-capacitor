import type { AppActorAttributionStatus } from './enums';
import { AppActorAttributionProvider } from './enums';
import type { JsonObject } from './internal/json';
import { byteLength, fromEntries, isIterable, isRecord } from './internal/json';

export type AppActorKeyValueInput<T = unknown> = Record<string, T> | Iterable<readonly [string, T]>;

const LEGACY_PROFILE_CURRENT_ALIASES = new Set([
  'appVersion',
  'appBuild',
  'sdkVersion',
  'platform',
  'platformFlavor',
  'platformVersion',
  'osVersion',
  'deviceModel',
  'bundleId',
  'locale',
  'timezone',
  'storefrontCountry',
  'ipCountry',
  'localeCountry',
  'attConsentStatus',
  'deviceLocale',
  'userCountry',
  'userCountrySource',
]);

/** Rejects an empty or whitespace-padded string, and one over `maxBytes` of UTF-8. */
function requireUnpadded(value: string, label: string, maxBytes?: number): void {
  if (!value || value.trim() !== value) {
    throw new Error(`${label} must not be empty or padded with whitespace.`);
  }
  if (maxBytes != null && byteLength(value) > maxBytes) {
    throw new Error(`${label} must be at most ${maxBytes} bytes.`);
  }
}

/** The rules developer keys share: length, characters, and the reserved `appactor.` prefix. */
function validateKeyFormat(key: string, label: string, prefixLabel = label): void {
  if (key.length > 64) {
    throw new Error(`${label} can contain at most 64 characters.`);
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(key)) {
    throw new Error(`${label} may only contain letters, numbers, underscore, dot, colon, or dash.`);
  }
  if (key.toLowerCase().startsWith('appactor.')) {
    throw new Error(`${prefixLabel} cannot start with "appactor.".`);
  }
}

export function validateCustomKey(key: string): void {
  if (!key) {
    throw new Error('Attribute key cannot be empty.');
  }
  validateKeyFormat(key, 'Attribute keys', 'Custom attribute keys');
  if (key.toLowerCase().startsWith('integration.')) {
    throw new Error('Integration identifiers must use setIntegrationIdentifier().');
  }
  if (LEGACY_PROFILE_CURRENT_ALIASES.has(key)) {
    throw new Error('Profile context fields are reserved for AppActor automatic profile context.');
  }
}

export function validateEmail(email: string): void {
  requireUnpadded(email, 'Email');
  if (byteLength(email) > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email must be valid.');
  }
}

export function validatePhoneNumber(phoneNumber: string): void {
  requireUnpadded(phoneNumber, 'Phone number');
  const digitCount = (phoneNumber.match(/\d/g) ?? []).length;
  if (byteLength(phoneNumber) > 64 || digitCount < 3 || !/^[+0-9().\-\s]+$/.test(phoneNumber)) {
    throw new Error('Phone number must be valid.');
  }
}

export function validateIntegrationIdentifierType(type: string): void {
  requireUnpadded(type, 'Integration identifier type');
  validateKeyFormat(type, 'Integration identifier type');
}

export function validateIntegrationIdentifierValue(value: string): void {
  requireUnpadded(value, 'Integration identifier value', 1024);
}

function entriesFromInput<T>(input: AppActorKeyValueInput<T>, name: string): Array<readonly [string, T]> {
  if (isIterable(input)) {
    const normalized: Array<readonly [string, T]> = [];
    let index = 0;
    for (const entry of input) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error(`${name}[${index}] must be a [key, value] entry tuple.`);
      }
      const [key, value] = entry;
      if (typeof key !== 'string') {
        throw new Error(`${name}[${index}] key must be a string.`);
      }
      normalized.push([key, value as T]);
      index += 1;
    }

    return normalized;
  }

  if (isRecord(input)) {
    return Object.entries(input);
  }

  throw new Error(`${name} must be an object or iterable of [key, value] entries.`);
}

export function normalizeAttributeValue(value: unknown, name = 'value'): unknown {
  if (value instanceof AppActorAttributeValue) {
    return value.toJson();
  }
  if (value == null) {
    throw new Error(`${name} cannot be null.`);
  }
  if (typeof value === 'string') {
    if (byteLength(value) > 1024) {
      throw new Error(`${name} strings must be at most 1024 bytes.`);
    }
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${name} numbers must be finite.`);
    }
    return value;
  }
  if (value instanceof Date) {
    return AppActorAttributeValue.dateTime(value).toJson();
  }
  // Array.from turns holes into `undefined`, which the checks below reject.
  const listValue = isIterable(value) ? Array.from(value) : null;
  if (listValue) {
    if (listValue.length > 20) {
      throw new Error(`${name} lists can contain at most 20 items.`);
    }
    if (listValue.every((item) => typeof item === 'string')) {
      return listValue;
    }
    if (listValue.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      return listValue;
    }
    if (listValue.every((item) => typeof item === 'boolean')) {
      return listValue;
    }
    throw new Error(`${name} lists must contain only strings, finite numbers, or booleans.`);
  }
  throw new Error(`${name} must be a string, number, boolean, Date, AppActorAttributeValue, or a flat primitive list.`);
}

/** Validates custom keys and normalizes values; shared by `setAttributes` and attribution metadata. */
export function normalizeKeyValues(input: AppActorKeyValueInput, name: string): JsonObject {
  return fromEntries(
    entriesFromInput(input, name).map(([key, value]) => {
      validateCustomKey(key);
      return [key, normalizeAttributeValue(value, `${name}[${key}]`)] as const;
    }),
  );
}

export class AppActorAttributeValue {
  private constructor(
    public readonly value: unknown,
    public readonly valueType?: string,
  ) {}

  static string(value: string): AppActorAttributeValue {
    return new AppActorAttributeValue(value);
  }

  static number(value: number): AppActorAttributeValue {
    return new AppActorAttributeValue(value);
  }

  static boolean(value: boolean): AppActorAttributeValue {
    return new AppActorAttributeValue(value);
  }

  static stringList(value: string[]): AppActorAttributeValue {
    return new AppActorAttributeValue(value);
  }

  static numberList(value: number[]): AppActorAttributeValue {
    return new AppActorAttributeValue(value);
  }

  static boolList(value: boolean[]): AppActorAttributeValue {
    return new AppActorAttributeValue(value);
  }

  static dateTime(value: Date): AppActorAttributeValue {
    return new AppActorAttributeValue(value.toISOString(), 'date');
  }

  toJson(): unknown {
    if (this.valueType) {
      return { value: this.value, valueType: this.valueType };
    }
    return normalizeAttributeValue(this.value);
  }
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Attribution data often comes untyped from an attribution SDK's callback, so a field of the wrong
 * type is dropped rather than failing the whole attribution, as in the React Native SDK; a numeric
 * ID is kept as its string.
 */
function attributionString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value : undefined;
}

/** The attribution string fields and their wire names, in the order they are sent. */
const ATTRIBUTION_STRING_FIELDS = {
  providerName: 'provider_name',
  campaignId: 'campaign_id',
  campaignName: 'campaign_name',
  adGroupId: 'ad_group_id',
  adGroupName: 'ad_group_name',
  adId: 'ad_id',
  adName: 'ad_name',
  creativeId: 'creative_id',
  creativeName: 'creative_name',
  keywordId: 'keyword_id',
  keyword: 'keyword',
  network: 'network',
  source: 'source',
  medium: 'medium',
  campaign: 'campaign',
  adGroup: 'ad_group',
  ad: 'ad',
  creative: 'creative',
  clickId: 'click_id',
} as const;

type AttributionStringField = keyof typeof ATTRIBUTION_STRING_FIELDS;

const attributionStringFields = Object.entries(ATTRIBUTION_STRING_FIELDS) as Array<[AttributionStringField, string]>;

export interface AppActorAttributionOptions {
  provider: AppActorAttributionProvider;
  providerOverride?: string;
  status?: AppActorAttributionStatus;
  providerName?: string;
  campaignId?: string;
  campaignName?: string;
  adGroupId?: string;
  adGroupName?: string;
  adId?: string;
  adName?: string;
  creativeId?: string;
  creativeName?: string;
  keywordId?: string;
  keyword?: string;
  network?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  adGroup?: string;
  ad?: string;
  creative?: string;
  clickId?: string;
  attributedAt?: Date;
  metadata?: AppActorKeyValueInput;
}

export class AppActorAttribution {
  readonly provider: AppActorAttributionProvider;
  readonly providerOverride?: string;
  readonly status?: AppActorAttributionStatus;
  readonly providerName?: string;
  readonly campaignId?: string;
  readonly campaignName?: string;
  readonly adGroupId?: string;
  readonly adGroupName?: string;
  readonly adId?: string;
  readonly adName?: string;
  readonly creativeId?: string;
  readonly creativeName?: string;
  readonly keywordId?: string;
  readonly keyword?: string;
  readonly network?: string;
  readonly source?: string;
  readonly medium?: string;
  readonly campaign?: string;
  readonly adGroup?: string;
  readonly ad?: string;
  readonly creative?: string;
  readonly clickId?: string;
  readonly attributedAt?: Date;
  readonly metadata: AppActorKeyValueInput;

  constructor(options: AppActorAttributionOptions) {
    this.provider = options.provider;
    this.providerOverride = attributionString(options.providerOverride);
    this.status = options.status;
    for (const [field] of attributionStringFields) {
      (this as Partial<Record<AttributionStringField, string>>)[field] = attributionString(options[field]);
    }
    this.attributedAt = isValidDate(options.attributedAt) ? options.attributedAt : undefined;
    // Copied, so a one-shot iterator (such as map.entries()) still has its entries on a retry.
    this.metadata = isIterable(options.metadata) ? Array.from(options.metadata) : (options.metadata ?? {});
  }

  static customProvider(
    provider: string,
    options: Omit<AppActorAttributionOptions, 'provider' | 'providerOverride'> = {},
  ): AppActorAttribution {
    return new AppActorAttribution({
      provider: AppActorAttributionProvider.Custom,
      providerOverride: provider,
      ...options,
    });
  }

  toJson(): JsonObject {
    if (this.providerOverride != null) {
      requireUnpadded(this.providerOverride, 'Attribution provider', 64);
    }
    const json: JsonObject = { provider: this.providerOverride ?? this.provider };
    if (this.status) {
      json.status = this.status;
    }
    for (const [field, wireName] of attributionStringFields) {
      const value = this[field];
      if (value != null) {
        requireUnpadded(value, `Attribution field "${wireName}"`, 1024);
        json[wireName] = value;
      }
    }
    if (this.attributedAt) {
      json.attributed_at = this.attributedAt.toISOString();
    }
    const metadata = normalizeKeyValues(this.metadata, 'metadata');
    if (Object.keys(metadata).length > 0) {
      json.metadata = metadata;
    }
    return json;
  }
}
