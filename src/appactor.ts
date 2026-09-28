import type { AppActorAttribution, AppActorKeyValueInput } from './attributes';
import {
  normalizeAttributeValue,
  normalizeKeyValues,
  validateCustomKey,
  validateEmail,
  validateIntegrationIdentifierType,
  validateIntegrationIdentifierValue,
  validatePhoneNumber,
} from './attributes';
import { currentPlatform, execute, isDevelopmentRuntime } from './bridge';
import type { AppActorLogLevel, AppActorStoreCapability, AppActorSubscriptionReplacementMode } from './enums';
import { AppActorIntegrationIdentifier, parseStoreCapability } from './enums';
import { UnsupportedError } from './errors';
import {
  AppActorEventStream,
  SDK_EVENTS,
  beginReset,
  endReset,
  hasCustomerInfoListeners,
  hasReceivedCustomerInfo,
  replayCustomerInfo,
  setSdkLogMirroring,
} from './events';
import type { JsonObject } from './internal/json';
import { asBoolean, asStringArray, ensureRecord, isRecord, optionalInteger, optionalString } from './internal/json';
import type { AppActorOffering, AppActorPackage, AppActorPlatformKeys } from './models';
import {
  AppActorAsaDiagnostics,
  AppActorAsaOptions,
  AppActorCustomerInfo,
  AppActorDeferredPurchaseEvent,
  AppActorExperiment,
  AppActorExperimentAssignment,
  AppActorOfferings,
  AppActorOptions,
  AppActorPurchaseIntent,
  AppActorPurchaseResult,
  AppActorReceiptPipelineEvent,
  AppActorRemoteConfigItem,
  AppActorRemoteConfigs,
  AppActorSdkLogEvent,
  AppActorStorefront,
} from './models';
import { appActorCapacitorVersion } from './version';

const METHOD_NAMES = {
  configure: 'configure',
  reset: 'reset',
  getSdkVersion: 'get_sdk_version',
  logIn: 'log_in',
  logOut: 'log_out',
  purchasePackage: 'purchase_package',
  restorePurchases: 'restore_purchases',
  syncPurchases: 'sync_purchases',
  quietSyncPurchases: 'quiet_sync_purchases',
  drainReceiptQueueAndRefreshCustomer: 'drain_receipt_queue_and_refresh_customer',
  getCustomerInfo: 'get_customer_info',
  getOfferings: 'get_offerings',
  activeEntitlementKeysOffline: 'active_entitlement_keys_offline',
  getRemoteConfigs: 'get_remote_configs',
  getExperimentAssignment: 'get_experiment_assignment',
  setLogLevel: 'set_log_level',
  enableAppleSearchAdsTracking: 'enable_apple_search_ads_tracking',
  presentOfferCodeRedeemSheet: 'present_offer_code_redeem_sheet',
  getAsaDiagnostics: 'get_asa_diagnostics',
  getPendingAsaPurchaseEventCount: 'get_pending_asa_purchase_event_count',
  getAsaFirstInstallOnDevice: 'get_asa_first_install_on_device',
  getAsaFirstInstallOnAccount: 'get_asa_first_install_on_account',
  getAppUserId: 'get_app_user_id',
  getIsAnonymous: 'get_is_anonymous',
  getCachedOfferings: 'get_cached_offerings',
  getCachedRemoteConfigs: 'get_cached_remote_configs',
  getCachedCustomerInfo: 'get_cached_customer_info',
  getRemoteConfig: 'get_remote_config',
  purchaseFromIntent: 'purchase_from_intent',
  enableInstallReferrer: 'enable_install_referrer',
  setFallbackOfferings: 'set_fallback_offerings',
  canMakePurchases: 'can_make_purchases',
  getStorefront: 'get_storefront',
  getStoreCapabilities: 'get_store_capabilities',
  setAttributes: 'set_attributes',
  setAttribute: 'set_attribute',
  unsetAttribute: 'unset_attribute',
  setEmail: 'set_email',
  setDisplayName: 'set_display_name',
  setPhoneNumber: 'set_phone_number',
  setPushToken: 'set_push_token',
  collectDeviceIdentifiers: 'collect_device_identifiers',
  setIntegrationIdentifier: 'set_integration_identifier',
  updateAttribution: 'update_attribution',
  setMediaSource: 'set_media_source',
  setCampaign: 'set_campaign',
  setAdGroup: 'set_ad_group',
  setAd: 'set_ad',
  setKeyword: 'set_keyword',
  setCreative: 'set_creative',
} as const;

const APP_ACTOR_SINGLETON_GUARD = Symbol('AppActor.singleton');

export type AppActorConfigureOptions = {
  appUserId?: string;
  /** `AppActorOptions`, or a plain `{ logLevel }` object. */
  options?: Pick<AppActorOptions, 'logLevel'>;
};

export type AppActorPurchasePackageOptions = {
  offeringId?: string;
  oldPurchaseToken?: string;
  replacementMode?: AppActorSubscriptionReplacementMode;
  quantity?: number;
  placement?: string | null;
};

export type AppActorRestorePurchasesOptions = {
  syncWithAppStore?: boolean;
};

type AsaFields = Partial<Pick<AppActorAsaOptions, 'autoTrackPurchases' | 'trackInSandbox' | 'debugMode'>>;

/** `AppActorAsaOptions`, the same fields as a plain object, or either wrapped as `{ options }`. */
export type AppActorSearchAdsOptions = AsaFields | { options?: AsaFields };

function resolveSearchAdsOptions(options?: AppActorSearchAdsOptions): AppActorAsaOptions {
  const fields = isRecord(options) && 'options' in options ? options.options : options;
  const record = ensureRecord(fields);
  // A missing or non-boolean field takes the AppActorAsaOptions default; like the React Native
  // SDK, this never throws, so it can't stop the configure() that usually follows.
  return new AppActorAsaOptions(
    asBoolean(record.autoTrackPurchases),
    asBoolean(record.trackInSandbox),
    asBoolean(record.debugMode),
  );
}

function resolveApiKey(apiKey: string | AppActorPlatformKeys): string {
  if (typeof apiKey === 'string') {
    return apiKey;
  }

  // Duck-typed: TypeScript accepts a plain `{ ios, android }` object here, and so does this.
  if (!isRecord(apiKey) || typeof apiKey.ios !== 'string' || typeof apiKey.android !== 'string') {
    throw new Error('Expected a string or AppActorPlatformKeys.');
  }

  const platform = currentPlatform();
  if (platform === 'ios') {
    return apiKey.ios;
  }
  if (platform === 'android') {
    return apiKey.android;
  }

  throw new UnsupportedError('AppActorPlatformKeys is only supported on iOS and Android.');
}

function requireIos(methodName: string): void {
  if (currentPlatform() !== 'ios') {
    throw new UnsupportedError(`${methodName} is iOS only`);
  }
}

/**
 * Decodes a cached value, or returns `null` when native had none: it then answers `{"success": null}`,
 * which the bridge hands over as `{ value: null }`. A cached payload always carries one of its DTO's
 * guaranteed keys; single optional fields can't be relied on, since the iOS encoder omits them.
 */
function decodeCached<T>(
  response: JsonObject,
  presentKeys: readonly string[],
  decode: (json: JsonObject) => T,
): T | null {
  return response.value != null || presentKeys.some((key) => key in response) ? decode(response) : null;
}

function normalizePlacement(placement?: string | null): string | undefined {
  if (placement == null) {
    return undefined;
  }

  const normalized = placement.trim();
  if (normalized.length === 0 || normalized.length > 255) {
    return undefined;
  }

  return normalized;
}

/** Base64 without a dependency; chunked because spreading a large array into `fromCharCode` overflows the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export class AppActor {
  static readonly instance = new AppActor(APP_ACTOR_SINGLETON_GUARD);

  private stagedAsaOptions?: AppActorAsaOptions;

  /** A reset still running natively. Native ignores a configure that arrives during one, so calls wait for it. */
  private pendingReset?: Promise<void>;

  /** Counts resets, so a configure() that a reset overtakes leaves the next user's state alone. */
  private resets = 0;

  /** configure() calls still running; the last one to finish decides on replaying customer info. */
  private configuring = 0;

  private constructor(guard: symbol) {
    if (guard !== APP_ACTOR_SINGLETON_GUARD) {
      throw new Error('AppActor cannot be instantiated directly. Use AppActor.instance.');
    }
  }

  /** Posts at once, in call order, unless a reset is still running natively. */
  private async call(method: string, params?: JsonObject): Promise<JsonObject> {
    if (this.pendingReset) {
      await this.pendingReset;
    }
    return execute(method, params);
  }

  readonly onCustomerInfoUpdated = new AppActorEventStream(
    SDK_EVENTS.customerInfoUpdated,
    AppActorCustomerInfo.fromJson,
  );

  readonly onReceiptPipelineEvent = new AppActorEventStream(
    SDK_EVENTS.receiptPipelineEvent,
    AppActorReceiptPipelineEvent.fromJson,
  );

  readonly onPurchaseIntent = new AppActorEventStream(
    SDK_EVENTS.purchaseIntentReceived,
    AppActorPurchaseIntent.fromJson,
  );

  readonly onDeferredPurchaseResolved = new AppActorEventStream(
    SDK_EVENTS.deferredPurchaseResolved,
    AppActorDeferredPurchaseEvent.fromJson,
  );

  readonly onSdkLog = new AppActorEventStream(SDK_EVENTS.sdkLog, AppActorSdkLogEvent.fromJson);

  enableSearchAdsTracking(options?: AppActorSearchAdsOptions): void {
    this.stagedAsaOptions = resolveSearchAdsOptions(options);
  }

  async configure(apiKey: string | AppActorPlatformKeys, options: AppActorConfigureOptions = {}): Promise<void> {
    const payload: JsonObject = {
      api_key: resolveApiKey(apiKey),
      ...(options.appUserId !== undefined ? { app_user_id: options.appUserId } : {}),
      options: {
        ...new AppActorOptions(options.options?.logLevel).toJson(),
        platform_info: {
          flavor: 'capacitor',
          version: appActorCapacitorVersion,
        },
      },
    };
    // Sent once, by the configure that follows enableSearchAdsTracking(). Taken now so a concurrent
    // configure() doesn't send it too, and put back if this one fails, unless a reset came in between.
    const asaOptions = this.stagedAsaOptions;
    this.stagedAsaOptions = undefined;
    const resets = this.resets;

    setSdkLogMirroring(isDevelopmentRuntime());
    this.configuring += 1;
    try {
      await this.call(METHOD_NAMES.configure, payload);
      if (asaOptions && currentPlatform() === 'ios' && resets === this.resets) {
        await this.call(METHOD_NAMES.enableAppleSearchAdsTracking, asaOptions.toJson());
      }
    } catch (error) {
      if (resets === this.resets) {
        this.stagedAsaOptions ??= asaOptions;
      }
      throw error;
    } finally {
      this.configuring -= 1;
    }
    await this.replayCustomerInfoIfMissed(resets);
  }

  /**
   * A page loaded while native is already configured (a reload, or a new Android Activity in a
   * live process) gets no `customer_info_updated` from configure(): native ignores it. Its
   * listeners get the info native holds in memory instead (no network request). Native's empty
   * info (no `app_user_id`: nothing fetched for the current user yet) isn't replayed; on a first
   * launch native sends nothing then either.
   */
  private async replayCustomerInfoIfMissed(resets: number): Promise<void> {
    // Checked first: a reset that overtook configure() would hold the read until it finishes.
    if (this.configuring > 0 || hasReceivedCustomerInfo() || resets !== this.resets || !hasCustomerInfoListeners()) {
      return;
    }
    // A failed read leaves configure() successful: `{}` has no app_user_id.
    const info = await this.call(METHOD_NAMES.getCachedCustomerInfo).catch((): JsonObject => ({}));
    if (!hasReceivedCustomerInfo() && resets === this.resets && typeof info.app_user_id === 'string') {
      replayCustomerInfo(info);
    }
  }

  /**
   * Signs the user out of AppActor. Await it before reloading or navigating the page, or before
   * configuring from another WebView: native ignores a configure that arrives while it resets, and
   * only this page knows to wait.
   */
  async reset(): Promise<void> {
    // Cleared up front so a configure() made before this resolves keeps what it sets.
    this.resets += 1;
    this.stagedAsaOptions = undefined;
    beginReset();

    const reset = this.call(METHOD_NAMES.reset);
    const settled = reset.then(
      () => undefined,
      () => undefined,
    );
    this.pendingReset = settled;
    try {
      await reset;
    } finally {
      endReset();
      if (this.pendingReset === settled) {
        this.pendingReset = undefined;
      }
    }
  }

  async sdkVersion(): Promise<string> {
    const response = await this.call(METHOD_NAMES.getSdkVersion);
    return optionalString(response.value, 'value') ?? '';
  }

  async setLogLevel(level: AppActorLogLevel): Promise<void> {
    await this.call(METHOD_NAMES.setLogLevel, { log_level: level });
  }

  async enableInstallReferrer(): Promise<void> {
    if (currentPlatform() !== 'android') {
      return;
    }
    await this.call(METHOD_NAMES.enableInstallReferrer);
  }

  async logIn(appUserId: string): Promise<AppActorCustomerInfo> {
    const response = await this.call(METHOD_NAMES.logIn, {
      new_app_user_id: appUserId,
    });
    return AppActorCustomerInfo.fromJson(response);
  }

  async logOut(): Promise<boolean> {
    const response = await this.call(METHOD_NAMES.logOut);
    return asBoolean(response.value) === true;
  }

  async getAppUserId(): Promise<string | null> {
    const response = await this.call(METHOD_NAMES.getAppUserId);
    return optionalString(response.value, 'value') ?? null;
  }

  async getIsAnonymous(): Promise<boolean> {
    const response = await this.call(METHOD_NAMES.getIsAnonymous);
    return asBoolean(response.value) === true;
  }

  async purchasePackage(
    pkg: AppActorPackage,
    options: AppActorPurchasePackageOptions = {},
  ): Promise<AppActorPurchaseResult> {
    if (options.quantity != null) {
      if (!Number.isInteger(options.quantity)) {
        throw new Error('Purchase quantity must be an integer.');
      }
      if (options.quantity < 1) {
        throw new Error('Purchase quantity must be at least 1.');
      }
    }

    const placement = normalizePlacement(options.placement);
    const offeringId = options.offeringId ?? pkg.offeringId;
    const payload: JsonObject = {
      package_id: pkg.id,
      ...(offeringId != null ? { offering_id: offeringId } : {}),
      ...(options.oldPurchaseToken ? { old_purchase_token: options.oldPurchaseToken } : {}),
      ...(options.replacementMode ? { replacement_mode: options.replacementMode } : {}),
      ...(options.quantity != null ? { quantity: options.quantity } : {}),
      ...(placement ? { placement } : {}),
    };

    const response = await this.call(METHOD_NAMES.purchasePackage, payload);
    return AppActorPurchaseResult.fromJson(response);
  }

  async restorePurchases(options: AppActorRestorePurchasesOptions = {}): Promise<AppActorCustomerInfo> {
    const response = await this.call(METHOD_NAMES.restorePurchases, {
      ...(options.syncWithAppStore != null ? { sync_with_app_store: options.syncWithAppStore } : {}),
    });
    return AppActorCustomerInfo.fromJson(response);
  }

  async syncPurchases(): Promise<AppActorCustomerInfo> {
    return AppActorCustomerInfo.fromJson(await this.call(METHOD_NAMES.syncPurchases));
  }

  /** @deprecated Use `syncPurchases()`. */
  async quietSyncPurchases(): Promise<AppActorCustomerInfo> {
    return AppActorCustomerInfo.fromJson(await this.call(METHOD_NAMES.quietSyncPurchases));
  }

  async drainReceiptQueueAndRefreshCustomer(): Promise<AppActorCustomerInfo> {
    return AppActorCustomerInfo.fromJson(await this.call(METHOD_NAMES.drainReceiptQueueAndRefreshCustomer));
  }

  async setFallbackOfferings(bytes: Uint8Array | ArrayBuffer): Promise<void> {
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await this.call(METHOD_NAMES.setFallbackOfferings, {
      json_data: bytesToBase64(payload),
    });
  }

  async getCustomerInfo(): Promise<AppActorCustomerInfo> {
    return AppActorCustomerInfo.fromJson(await this.call(METHOD_NAMES.getCustomerInfo));
  }

  async getOfferings(): Promise<AppActorOfferings> {
    return AppActorOfferings.fromJson(await this.call(METHOD_NAMES.getOfferings));
  }

  /**
   * Fetches offerings (see `getOfferings`) and returns the one with the given
   * `offeringKey`, or `undefined` if the app has no such offering.
   *
   * ```ts
   * const onboarding = await AppActor.instance.getOffering('onboarding');
   * ```
   */
  async getOffering(offeringKey: string): Promise<AppActorOffering | undefined> {
    return (await this.getOfferings()).getOffering(offeringKey);
  }

  async activeEntitlementKeysOffline(): Promise<Set<string>> {
    const response = await this.call(METHOD_NAMES.activeEntitlementKeysOffline);
    return new Set(asStringArray(response.keys, 'keys'));
  }

  async getCachedOfferings(): Promise<AppActorOfferings | null> {
    const response = await this.call(METHOD_NAMES.getCachedOfferings);
    // 'current' is optional and omitted by the iOS encoder when no offering is
    // flagged current, so probe on the always-present 'all'/'verification' keys.
    return decodeCached(response, ['all', 'verification'], AppActorOfferings.fromJson);
  }

  async getCachedRemoteConfigs(): Promise<AppActorRemoteConfigs | null> {
    const response = await this.call(METHOD_NAMES.getCachedRemoteConfigs);
    return decodeCached(response, ['items'], AppActorRemoteConfigs.fromJson);
  }

  async getCachedCustomerInfo(): Promise<AppActorCustomerInfo> {
    return AppActorCustomerInfo.fromJson(await this.call(METHOD_NAMES.getCachedCustomerInfo));
  }

  /** Android asks Google Play; iOS always answers `true`; the web answers `false`. */
  async canMakePurchases(): Promise<boolean> {
    const platform = currentPlatform();
    if (platform !== 'android') {
      return platform === 'ios';
    }
    const response = await this.call(METHOD_NAMES.canMakePurchases);
    return asBoolean(response.value) === true;
  }

  /** The Google Play storefront; `null` on iOS and the web. */
  async getStorefront(): Promise<AppActorStorefront | null> {
    if (currentPlatform() !== 'android') {
      return null;
    }
    const response = await this.call(METHOD_NAMES.getStorefront);
    return decodeCached(response, ['store'], AppActorStorefront.fromJson);
  }

  /** What Google Play supports on this device; empty on iOS and the web. */
  async getStoreCapabilities(): Promise<Set<AppActorStoreCapability>> {
    if (currentPlatform() !== 'android') {
      return new Set();
    }
    const response = await this.call(METHOD_NAMES.getStoreCapabilities);
    return new Set(
      asStringArray(response.value, 'value')
        .map(parseStoreCapability)
        .filter((entry): entry is AppActorStoreCapability => entry != null),
    );
  }

  async setAttributes(attributes: AppActorKeyValueInput): Promise<void> {
    await this.call(METHOD_NAMES.setAttributes, {
      attributes: normalizeKeyValues(attributes, 'attributes'),
    });
  }

  async setAttribute(key: string, value: unknown): Promise<void> {
    validateCustomKey(key);
    await this.call(METHOD_NAMES.setAttribute, {
      key,
      value: normalizeAttributeValue(value),
    });
  }

  async unsetAttribute(key: string): Promise<void> {
    validateCustomKey(key);
    await this.call(METHOD_NAMES.unsetAttribute, { key });
  }

  async setEmail(email: string | null): Promise<void> {
    if (email != null) {
      validateEmail(email);
    }
    await this.call(METHOD_NAMES.setEmail, { email: email ?? null });
  }

  async setDisplayName(displayName: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setDisplayName, {
      display_name: displayName ?? null,
    });
  }

  async setPhoneNumber(phoneNumber: string | null): Promise<void> {
    if (phoneNumber != null) {
      validatePhoneNumber(phoneNumber);
    }
    await this.call(METHOD_NAMES.setPhoneNumber, {
      phone_number: phoneNumber ?? null,
    });
  }

  async setPushToken(pushToken: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setPushToken, {
      push_token: pushToken ?? null,
    });
  }

  async collectDeviceIdentifiers(): Promise<void> {
    await this.call(METHOD_NAMES.collectDeviceIdentifiers);
  }

  async setIntegrationIdentifier(type: AppActorIntegrationIdentifier, value: string): Promise<void> {
    await this.setCustomIntegrationIdentifier(type, value);
  }

  async unsetIntegrationIdentifier(type: AppActorIntegrationIdentifier): Promise<void> {
    await this.unsetCustomIntegrationIdentifier(type);
  }

  async setCustomIntegrationIdentifier(type: AppActorIntegrationIdentifier | string, value: string): Promise<void> {
    validateIntegrationIdentifierType(String(type));
    validateIntegrationIdentifierValue(value);
    await this.call(METHOD_NAMES.setIntegrationIdentifier, {
      type,
      value,
    });
  }

  async unsetCustomIntegrationIdentifier(type: AppActorIntegrationIdentifier | string): Promise<void> {
    validateIntegrationIdentifierType(String(type));
    await this.call(METHOD_NAMES.setIntegrationIdentifier, {
      type,
      value: null,
    });
  }

  async setAppsflyerID(value: string): Promise<void> {
    await this.setIntegrationIdentifier(AppActorIntegrationIdentifier.AppsFlyerId, value);
  }

  async setAppsFlyerID(value: string): Promise<void> {
    await this.setAppsflyerID(value);
  }

  async setAdjustID(value: string): Promise<void> {
    await this.setIntegrationIdentifier(AppActorIntegrationIdentifier.AdjustId, value);
  }

  async setBranchID(value: string): Promise<void> {
    await this.setIntegrationIdentifier(AppActorIntegrationIdentifier.BranchId, value);
  }

  async setFirebaseAppInstanceID(value: string): Promise<void> {
    await this.setIntegrationIdentifier(AppActorIntegrationIdentifier.FirebaseAppInstanceId, value);
  }

  async setOneSignalID(value: string): Promise<void> {
    await this.setIntegrationIdentifier(AppActorIntegrationIdentifier.OneSignalPlayerId, value);
  }

  async updateAttribution(attribution: AppActorAttribution): Promise<void> {
    await this.call(METHOD_NAMES.updateAttribution, attribution.toJson());
  }

  async setMediaSource(value: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setMediaSource, { value: value ?? null });
  }

  async setCampaign(value: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setCampaign, { value: value ?? null });
  }

  async setAdGroup(value: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setAdGroup, { value: value ?? null });
  }

  async setAd(value: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setAd, { value: value ?? null });
  }

  async setKeyword(value: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setKeyword, { value: value ?? null });
  }

  async setCreative(value: string | null): Promise<void> {
    await this.call(METHOD_NAMES.setCreative, { value: value ?? null });
  }

  async getRemoteConfigs(): Promise<AppActorRemoteConfigs> {
    return AppActorRemoteConfigs.fromJson(await this.call(METHOD_NAMES.getRemoteConfigs));
  }

  async getExperimentAssignment(experimentKey: string): Promise<AppActorExperimentAssignment | null> {
    const response = await this.call(METHOD_NAMES.getExperimentAssignment, {
      experiment_key: experimentKey,
    });
    if (response.experiment_key == null) {
      return null;
    }
    return AppActorExperimentAssignment.fromJson(response);
  }

  /**
   * Resolves the user's standing in an experiment.
   *
   * Never `null`: when the user is not in the experiment the result reports
   * `isEnrolled === false`, `variantKey === null`, and every typed getter
   * returns its default. Same caching and errors as `getExperimentAssignment`.
   *
   * ```ts
   * const paywall = await AppActor.instance.getExperiment('paywall_test');
   * if (paywall.isVariant('annual_first')) showAnnualFirst();
   *
   * const showOnboarding = (await AppActor.instance.getExperiment('has_onboard')).boolValue(true);
   * const title = (await AppActor.instance.getExperiment('onboarding_flow')).get('title') ?? 'Welcome';
   * ```
   */
  async getExperiment(experimentKey: string): Promise<AppActorExperiment> {
    return new AppActorExperiment(experimentKey, await this.getExperimentAssignment(experimentKey));
  }

  async getRemoteConfig(key: string): Promise<AppActorRemoteConfigItem | null> {
    const response = await this.call(METHOD_NAMES.getRemoteConfig, { key });
    return decodeCached(response, ['key', 'value_type'], AppActorRemoteConfigItem.fromJson);
  }

  async getRemoteConfigBool(key: string): Promise<boolean | null> {
    return (await this.getRemoteConfig(key))?.boolValue ?? null;
  }

  async getRemoteConfigString(key: string): Promise<string | null> {
    return (await this.getRemoteConfig(key))?.stringValue ?? null;
  }

  async getRemoteConfigNumber(key: string): Promise<number | null> {
    return (await this.getRemoteConfig(key))?.numberValue ?? null;
  }

  async getRemoteConfigInt(key: string): Promise<number | null> {
    const value = (await this.getRemoteConfig(key))?.numberValue;
    if (value == null) {
      return null;
    }
    return Number.isInteger(value) ? value : null;
  }

  async presentOfferCodeRedeemSheet(): Promise<void> {
    requireIos('presentOfferCodeRedeemSheet');
    await this.call(METHOD_NAMES.presentOfferCodeRedeemSheet);
  }

  async getAsaDiagnostics(): Promise<AppActorAsaDiagnostics | null> {
    requireIos('getAsaDiagnostics');
    const response = await this.call(METHOD_NAMES.getAsaDiagnostics);
    return decodeCached(
      response,
      ['attribution_completed', 'pending_purchase_event_count', 'debug_mode'],
      AppActorAsaDiagnostics.fromJson,
    );
  }

  async getPendingAsaPurchaseEventCount(): Promise<number> {
    requireIos('getPendingAsaPurchaseEventCount');
    const response = await this.call(METHOD_NAMES.getPendingAsaPurchaseEventCount);
    return optionalInteger(response.value, 'value') ?? 0;
  }

  async getAsaFirstInstallOnDevice(): Promise<boolean> {
    requireIos('getAsaFirstInstallOnDevice');
    const response = await this.call(METHOD_NAMES.getAsaFirstInstallOnDevice);
    return asBoolean(response.value) === true;
  }

  async getAsaFirstInstallOnAccount(): Promise<boolean> {
    requireIos('getAsaFirstInstallOnAccount');
    const response = await this.call(METHOD_NAMES.getAsaFirstInstallOnAccount);
    return asBoolean(response.value) === true;
  }

  async purchaseFromIntent(intent: AppActorPurchaseIntent): Promise<AppActorPurchaseResult> {
    requireIos('purchaseFromIntent');
    const response = await this.call(METHOD_NAMES.purchaseFromIntent, {
      intent_id: intent.intentId,
    });
    return AppActorPurchaseResult.fromJson(response);
  }
}
