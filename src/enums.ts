import { ownValue } from './internal/json';

export enum AppActorLogLevel {
  Debug = 'debug',
  Verbose = 'verbose',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export enum AppActorStore {
  PlayStore = 'play_store',
  AppStore = 'app_store',
  Stripe = 'stripe',
  Promotional = 'promotional',
  Unknown = 'unknown',
}

export enum AppActorPackageType {
  Weekly = 'weekly',
  Monthly = 'monthly',
  TwoMonth = 'two_month',
  ThreeMonth = 'three_month',
  SixMonth = 'six_month',
  Annual = 'annual',
  Lifetime = 'lifetime',
  Consumable = 'consumable',
  Custom = 'custom',
}

export enum AppActorProductType {
  Subscription = 'subscription',
  NonConsumable = 'non_consumable',
  Consumable = 'consumable',
  Unknown = 'unknown',
}

export enum AppActorOwnershipType {
  Purchased = 'purchased',
  FamilyShared = 'family_shared',
  Unknown = 'unknown',
}

export enum AppActorPeriodType {
  Weekly = 'weekly',
  Monthly = 'monthly',
  TwoMonth = 'two_month',
  ThreeMonth = 'three_month',
  SixMonth = 'six_month',
  Annual = 'annual',
  Lifetime = 'lifetime',
  Normal = 'normal',
  Trial = 'trial',
  Intro = 'intro',
  Unknown = 'unknown',
}

export enum AppActorSubscriptionStatus {
  Active = 'active',
  GracePeriod = 'grace_period',
  BillingRetry = 'billing_retry',
  Expired = 'expired',
  Revoked = 'revoked',
  Upgraded = 'upgraded',
  Unknown = 'unknown',
}

export enum AppActorCancellationReason {
  CustomerCancelled = 'customer_cancelled',
  DeveloperCancelled = 'developer_cancelled',
  Unknown = 'unknown',
}

export enum AppActorConfigValueType {
  Boolean = 'boolean',
  Number = 'number',
  String = 'string',
  Json = 'json',
  Unknown = 'unknown',
}

export enum AppActorStoreCapability {
  Purchases = 'purchases',
  Subscriptions = 'subscriptions',
  InAppProducts = 'in_app_products',
  PurchaseHistory = 'purchase_history',
  Storefront = 'storefront',
}

export enum AppActorSubscriptionReplacementMode {
  WithTimeProration = 'with_time_proration',
  ChargeProrated = 'charge_prorated',
  WithoutProration = 'without_proration',
  ChargeFullPrice = 'charge_full_price',
  Deferred = 'deferred',
}

export enum AppActorIntegrationIdentifier {
  AppsFlyerId = 'appsflyer_id',
  AdjustId = 'adjust_adid',
  BranchId = 'branch_id',
  FirebaseAppInstanceId = 'firebase_app_instance_id',
  AmplitudeUserId = 'amplitude_user_id',
  AmplitudeDeviceId = 'amplitude_device_id',
  MixpanelDistinctId = 'mixpanel_distinct_id',
  FacebookAnonymousId = 'fb_anon_id',
  OneSignalPlayerId = 'onesignal_id',
}

export enum AppActorAttributionProvider {
  AppleSearchAds = 'apple_search_ads',
  GoogleAds = 'google_ads',
  Meta = 'meta',
  TikTok = 'tiktok',
  Snap = 'snap',
  AppsFlyer = 'appsflyer',
  Adjust = 'adjust',
  Branch = 'branch',
  Firebase = 'firebase',
  Custom = 'custom',
}

export enum AppActorAttributionStatus {
  NonOrganic = 'non_organic',
  Organic = 'organic',
  Unattributed = 'unattributed',
  Unresolved = 'unresolved',
  Error = 'error',
  Unknown = 'unknown',
}

export enum AppActorPurchaseStatus {
  Purchased = 'purchased',
  Cancelled = 'cancelled',
  Pending = 'pending',
  Restored = 'restored',
  Unknown = 'unknown',
}

export enum AppActorVerificationResult {
  NotRequested = 'notRequested',
  Verified = 'verified',
  VerifiedOnDevice = 'verifiedOnDevice',
  Failed = 'failed',
}

function fromEnumValue<T extends string, F = T>(
  allowed: readonly T[],
  value: unknown,
  fallback: F,
  aliases: Record<string, T> = {},
): T | F {
  if (typeof value !== 'string') {
    return fallback;
  }
  if (allowed.includes(value as T)) {
    return value as T;
  }
  return ownValue(aliases, value) ?? fallback;
}

export function parseStore(value: unknown): AppActorStore {
  return fromEnumValue(Object.values(AppActorStore), value, AppActorStore.Unknown, {
    playStore: AppActorStore.PlayStore,
    appStore: AppActorStore.AppStore,
  });
}

export function parsePackageType(value: unknown): AppActorPackageType {
  return fromEnumValue(Object.values(AppActorPackageType), value, AppActorPackageType.Custom, {
    two_months: AppActorPackageType.TwoMonth,
    twoMonth: AppActorPackageType.TwoMonth,
    three_months: AppActorPackageType.ThreeMonth,
    threeMonth: AppActorPackageType.ThreeMonth,
    six_months: AppActorPackageType.SixMonth,
    sixMonth: AppActorPackageType.SixMonth,
  });
}

export function parseProductType(value: unknown): AppActorProductType {
  return fromEnumValue(Object.values(AppActorProductType), value, AppActorProductType.Unknown, {
    nonConsumable: AppActorProductType.NonConsumable,
  });
}

export function parseOwnershipType(value: unknown): AppActorOwnershipType {
  return fromEnumValue(Object.values(AppActorOwnershipType), value, AppActorOwnershipType.Unknown, {
    familyShared: AppActorOwnershipType.FamilyShared,
  });
}

export function parsePeriodType(value: unknown): AppActorPeriodType {
  return fromEnumValue(Object.values(AppActorPeriodType), value, AppActorPeriodType.Unknown, {
    twoMonth: AppActorPeriodType.TwoMonth,
    threeMonth: AppActorPeriodType.ThreeMonth,
    sixMonth: AppActorPeriodType.SixMonth,
  });
}

export function parseSubscriptionStatus(value: unknown): AppActorSubscriptionStatus {
  return fromEnumValue(Object.values(AppActorSubscriptionStatus), value, AppActorSubscriptionStatus.Unknown, {
    gracePeriod: AppActorSubscriptionStatus.GracePeriod,
    billingRetry: AppActorSubscriptionStatus.BillingRetry,
  });
}

export function parseCancellationReason(value: unknown): AppActorCancellationReason {
  return fromEnumValue(Object.values(AppActorCancellationReason), value, AppActorCancellationReason.Unknown, {
    customerCancelled: AppActorCancellationReason.CustomerCancelled,
    developerCancelled: AppActorCancellationReason.DeveloperCancelled,
  });
}

export function parseConfigValueType(value: unknown): AppActorConfigValueType {
  return fromEnumValue(Object.values(AppActorConfigValueType), value, AppActorConfigValueType.Unknown);
}

export function parseStoreCapability(value: unknown): AppActorStoreCapability | null {
  return fromEnumValue(Object.values(AppActorStoreCapability), value, null, {
    inAppProducts: AppActorStoreCapability.InAppProducts,
    purchaseHistory: AppActorStoreCapability.PurchaseHistory,
  });
}

export function parsePurchaseStatus(value: unknown): AppActorPurchaseStatus {
  return fromEnumValue(Object.values(AppActorPurchaseStatus), value, AppActorPurchaseStatus.Unknown, {
    success: AppActorPurchaseStatus.Purchased,
  });
}

export function parseVerificationResult(value: unknown): AppActorVerificationResult {
  return fromEnumValue(Object.values(AppActorVerificationResult), value, AppActorVerificationResult.NotRequested);
}

export function appActorLogLevelWireValue(value: AppActorLogLevel): string {
  return value;
}

export function appActorLogLevelFromString(value: string): AppActorLogLevel {
  return fromEnumValue(Object.values(AppActorLogLevel), value, AppActorLogLevel.Info);
}

export function appActorStoreWireValue(value: AppActorStore): string {
  return value;
}

export function appActorStoreFromString(value: string): AppActorStore {
  return parseStore(value);
}

export function appActorPackageTypeWireValue(value: AppActorPackageType): string {
  return value;
}

export function appActorPackageTypeFromString(value: string): AppActorPackageType {
  return parsePackageType(value);
}

export function appActorProductTypeWireValue(value: AppActorProductType): string {
  return value;
}

export function appActorProductTypeFromString(value: string): AppActorProductType {
  return parseProductType(value);
}

export function appActorOwnershipTypeWireValue(value: AppActorOwnershipType): string {
  return value;
}

export function appActorOwnershipTypeFromString(value: string): AppActorOwnershipType {
  return parseOwnershipType(value);
}

export function appActorPeriodTypeWireValue(value: AppActorPeriodType): string {
  return value;
}

export function appActorPeriodTypeFromString(value: string): AppActorPeriodType {
  return parsePeriodType(value);
}

export function appActorSubscriptionStatusWireValue(value: AppActorSubscriptionStatus): string {
  return value;
}

export function appActorSubscriptionStatusFromString(value: string): AppActorSubscriptionStatus {
  return parseSubscriptionStatus(value);
}

export function appActorCancellationReasonWireValue(value: AppActorCancellationReason): string {
  return value;
}

export function appActorCancellationReasonFromString(value: string): AppActorCancellationReason {
  return parseCancellationReason(value);
}

export function appActorConfigValueTypeWireValue(value: AppActorConfigValueType): string {
  return value;
}

export function appActorConfigValueTypeFromString(value: string): AppActorConfigValueType {
  return parseConfigValueType(value);
}

export function appActorStoreCapabilityWireValue(value: AppActorStoreCapability): string {
  return value;
}

export function appActorStoreCapabilityFromString(value: string | null | undefined): AppActorStoreCapability | null {
  return parseStoreCapability(value);
}

export function appActorSubscriptionReplacementModeWireValue(value: AppActorSubscriptionReplacementMode): string {
  return value;
}

export function appActorSubscriptionReplacementModeFromString(
  value: string | null | undefined,
): AppActorSubscriptionReplacementMode | null {
  return fromEnumValue(Object.values(AppActorSubscriptionReplacementMode), value, null, {
    withTimeProration: AppActorSubscriptionReplacementMode.WithTimeProration,
    chargeProrated: AppActorSubscriptionReplacementMode.ChargeProrated,
    withoutProration: AppActorSubscriptionReplacementMode.WithoutProration,
    chargeFullPrice: AppActorSubscriptionReplacementMode.ChargeFullPrice,
  });
}

export function appActorIntegrationIdentifierWireValue(value: AppActorIntegrationIdentifier): string {
  return value;
}

export function appActorIntegrationIdentifierFromString(
  value: string | null | undefined,
): AppActorIntegrationIdentifier | null {
  return fromEnumValue(Object.values(AppActorIntegrationIdentifier), value, null, {
    appsFlyerId: AppActorIntegrationIdentifier.AppsFlyerId,
    adjustId: AppActorIntegrationIdentifier.AdjustId,
    branchId: AppActorIntegrationIdentifier.BranchId,
    firebaseAppInstanceId: AppActorIntegrationIdentifier.FirebaseAppInstanceId,
    amplitudeUserId: AppActorIntegrationIdentifier.AmplitudeUserId,
    amplitudeDeviceId: AppActorIntegrationIdentifier.AmplitudeDeviceId,
    mixpanelDistinctId: AppActorIntegrationIdentifier.MixpanelDistinctId,
    facebookAnonymousId: AppActorIntegrationIdentifier.FacebookAnonymousId,
    oneSignalPlayerId: AppActorIntegrationIdentifier.OneSignalPlayerId,
  });
}

export function appActorAttributionProviderWireValue(value: AppActorAttributionProvider): string {
  return value;
}

export function appActorAttributionProviderFromString(
  value: string | null | undefined,
): AppActorAttributionProvider | null {
  return fromEnumValue(Object.values(AppActorAttributionProvider), value, null, {
    appleSearchAds: AppActorAttributionProvider.AppleSearchAds,
    googleAds: AppActorAttributionProvider.GoogleAds,
    appsFlyer: AppActorAttributionProvider.AppsFlyer,
  });
}

export function appActorAttributionStatusWireValue(value: AppActorAttributionStatus): string {
  return value;
}

export function appActorAttributionStatusFromString(
  value: string | null | undefined,
): AppActorAttributionStatus | null {
  return fromEnumValue(Object.values(AppActorAttributionStatus), value, null, {
    nonOrganic: AppActorAttributionStatus.NonOrganic,
  });
}

export function appActorPurchaseStatusWireValue(value: AppActorPurchaseStatus): string {
  return value;
}

export function appActorPurchaseStatusFromString(value: string): AppActorPurchaseStatus {
  return parsePurchaseStatus(value);
}

export function appActorVerificationResultWireValue(value: AppActorVerificationResult): string {
  return value;
}

export function appActorVerificationResultIsVerified(value: AppActorVerificationResult): boolean {
  return value === AppActorVerificationResult.Verified || value === AppActorVerificationResult.VerifiedOnDevice;
}

export function appActorVerificationResultFromString(value: string): AppActorVerificationResult {
  return parseVerificationResult(value);
}
