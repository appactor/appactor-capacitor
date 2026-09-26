import type { AppActorCancellationReason, AppActorLogLevel, AppActorSubscriptionStatus } from './enums';
import {
  AppActorConfigValueType,
  AppActorOwnershipType,
  AppActorPackageType,
  AppActorPeriodType,
  AppActorProductType,
  AppActorPurchaseStatus,
  AppActorStore,
  AppActorVerificationResult,
  parseCancellationReason,
  parseConfigValueType,
  parseOwnershipType,
  parsePackageType,
  parsePeriodType,
  parseProductType,
  parsePurchaseStatus,
  parseStore,
  parseSubscriptionStatus,
  parseVerificationResult,
} from './enums';
import type { JsonMap, JsonObject } from './internal/json';
import {
  appActorModelEquals,
  asBoolean,
  asNumber,
  asObjectArray,
  asString,
  compareCodeUnits,
  fromEntries,
  isRecord,
  mapListValues,
  mapStringLists,
  mapValues,
  optionalBoolean,
  optionalInteger,
  optionalNumber,
  optionalObject,
  optionalString,
  optionalEnum,
  optionalRecordOf,
  optionalStringArray,
  ownValue,
  requireInteger,
  requireRecord,
  requireString,
} from './internal/json';

export class AppActorOptions {
  constructor(public readonly logLevel?: AppActorLogLevel) {}

  toJson(): JsonObject {
    return this.logLevel ? { log_level: this.logLevel } : {};
  }
}

/** One API key per store; `configure` picks the key for the platform the app runs on. */
export class AppActorPlatformKeys {
  constructor(
    public readonly ios: string,
    public readonly android: string,
  ) {}
}

export class AppActorAsaOptions {
  constructor(
    public readonly autoTrackPurchases = true,
    public readonly trackInSandbox = false,
    public readonly debugMode = false,
  ) {}

  toJson(): JsonObject {
    return {
      auto_track_purchases: this.autoTrackPurchases,
      track_in_sandbox: this.trackInSandbox,
      debug_mode: this.debugMode,
    };
  }
}

export class AppActorSdkLogEvent {
  constructor(
    public readonly level: string,
    public readonly message: string,
    public readonly category: string,
    public readonly timestamp: Date | null,
  ) {}

  static fromJson(json: JsonObject): AppActorSdkLogEvent {
    const rawTimestamp = optionalString(json.timestamp, 'timestamp');
    const timestamp = rawTimestamp != null && !Number.isNaN(Date.parse(rawTimestamp)) ? new Date(rawTimestamp) : null;

    return new AppActorSdkLogEvent(
      optionalString(json.level, 'level') ?? '',
      optionalString(json.message, 'message') ?? '',
      optionalString(json.category, 'category') ?? '',
      timestamp,
    );
  }
}

export class AppActorStorefront {
  constructor(
    public readonly store: AppActorStore,
    public readonly countryCode?: string,
  ) {}

  static fromJson(json: JsonObject): AppActorStorefront {
    return new AppActorStorefront(
      parseStore(optionalString(json.store, 'store')),
      optionalString(json.country_code, 'country_code'),
    );
  }
}

export class AppActorAsaDiagnostics {
  constructor(
    public readonly attributionCompleted: boolean,
    public readonly pendingPurchaseEventCount: number,
    public readonly debugMode: boolean,
    public readonly autoTrackPurchases: boolean,
    public readonly trackInSandbox: boolean,
  ) {}

  static fromJson(json: JsonObject): AppActorAsaDiagnostics {
    return new AppActorAsaDiagnostics(
      optionalBoolean(json.attribution_completed, 'attribution_completed') ?? false,
      optionalInteger(json.pending_purchase_event_count, 'pending_purchase_event_count') ?? 0,
      optionalBoolean(json.debug_mode, 'debug_mode') ?? false,
      optionalBoolean(json.auto_track_purchases, 'auto_track_purchases') ?? false,
      optionalBoolean(json.track_in_sandbox, 'track_in_sandbox') ?? false,
    );
  }
}

export class AppActorExperimentAssignment {
  constructor(
    public readonly experimentId: string,
    public readonly experimentKey: string,
    public readonly variantId: string,
    public readonly variantKey: string,
    public readonly payload: unknown,
    public readonly valueType: AppActorConfigValueType,
    public readonly assignedAt: string,
  ) {}

  equals(other: unknown): boolean {
    return other instanceof AppActorExperimentAssignment && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorExperimentAssignment {
    return new AppActorExperimentAssignment(
      optionalString(json.experiment_id, 'experiment_id') ?? '',
      optionalString(json.experiment_key, 'experiment_key') ?? '',
      optionalString(json.variant_id, 'variant_id') ?? '',
      optionalString(json.variant_key, 'variant_key') ?? '',
      json.payload,
      parseConfigValueType(optionalString(json.value_type, 'value_type') ?? AppActorConfigValueType.String),
      optionalString(json.assigned_at, 'assigned_at') ?? '',
    );
  }
}

/**
 * A user's standing in one experiment — always returned, also when the user is
 * not in it, so callers never null-check. Use `AppActor.instance.getExperiment`
 * to get one (examples there).
 */
export class AppActorExperiment {
  constructor(
    /** The developer-defined experiment key this was resolved for. */
    public readonly experimentKey: string,
    /** The raw assignment; `null` when the user is not in the experiment (not targeted, not running, …). */
    public readonly assignment: AppActorExperimentAssignment | null,
  ) {}

  /** `true` when the user has a variant in this experiment. */
  get isEnrolled(): boolean {
    return this.assignment != null;
  }

  /** The assigned variant's key (e.g. `'control'`), or `null` when not enrolled. */
  get variantKey(): string | null {
    return this.assignment?.variantKey ?? null;
  }

  /** The variant's payload, or `undefined` when not enrolled. */
  get payload(): unknown {
    return this.assignment?.payload;
  }

  /** `true` when the user is enrolled in the variant with this key. */
  isVariant(variantKey: string): boolean {
    return this.assignment?.variantKey === variantKey;
  }

  /** The payload as a boolean, or `defaultValue` when not enrolled or not a boolean. */
  boolValue(defaultValue: boolean): boolean {
    return asBoolean(this.payload) ?? defaultValue;
  }

  /** The payload as a string, or `defaultValue` when not enrolled or not a string. */
  stringValue(defaultValue: string): string {
    return asString(this.payload) ?? defaultValue;
  }

  /** The payload as an integer, or `defaultValue` when not enrolled or not a whole number. */
  intValue(defaultValue: number): number {
    return Number.isInteger(this.payload) ? (this.payload as number) : defaultValue;
  }

  /** The payload as a number, or `defaultValue` when not enrolled or not a finite number. */
  doubleValue(defaultValue: number): number {
    return asNumber(this.payload) ?? defaultValue;
  }

  /** A key of a JSON payload: `experiment.get('title')`. */
  get(key: string): unknown {
    const payload = this.payload;
    return isRecord(payload) ? ownValue(payload, key) : undefined;
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorExperiment && appActorModelEquals(this, other);
  }
}

export class AppActorReceiptPipelineEvent {
  static readonly typePostedOk = 'posted_ok';
  static readonly typeRetryScheduled = 'retry_scheduled';
  static readonly typePermanentlyRejected = 'permanently_rejected';
  static readonly typeDeadLettered = 'dead_lettered';
  static readonly typeDuplicateSkipped = 'duplicate_skipped';

  constructor(
    public readonly type: string,
    public readonly transactionId: string | undefined,
    public readonly productId: string,
    public readonly appUserId: string,
    public readonly retryCount?: number,
    public readonly nextAttemptAt?: string,
    public readonly errorCode?: string,
    public readonly key?: string,
  ) {}

  get isPostedOk(): boolean {
    return this.type === AppActorReceiptPipelineEvent.typePostedOk;
  }

  get isRetryScheduled(): boolean {
    return this.type === AppActorReceiptPipelineEvent.typeRetryScheduled;
  }

  get isPermanentlyRejected(): boolean {
    return this.type === AppActorReceiptPipelineEvent.typePermanentlyRejected;
  }

  get isDeadLettered(): boolean {
    return this.type === AppActorReceiptPipelineEvent.typeDeadLettered;
  }

  get isDuplicateSkipped(): boolean {
    return this.type === AppActorReceiptPipelineEvent.typeDuplicateSkipped;
  }

  static fromJson(json: JsonObject): AppActorReceiptPipelineEvent {
    return new AppActorReceiptPipelineEvent(
      optionalString(json.type, 'type') ?? '',
      optionalString(json.transaction_id, 'transaction_id'),
      optionalString(json.product_id, 'product_id') ?? '',
      optionalString(json.app_user_id, 'app_user_id') ?? '',
      optionalInteger(json.retry_count, 'retry_count'),
      optionalString(json.next_attempt_at, 'next_attempt_at'),
      optionalString(json.error_code, 'error_code'),
      optionalString(json.key, 'key'),
    );
  }
}

export class AppActorPurchaseIntent {
  constructor(
    public readonly intentId: string,
    public readonly productId: string,
    public readonly offerId?: string,
    public readonly offerType?: string,
  ) {}

  static fromJson(json: JsonObject): AppActorPurchaseIntent {
    return new AppActorPurchaseIntent(
      optionalString(json.intent_id, 'intent_id') ?? '',
      optionalString(json.product_id, 'product_id') ?? '',
      optionalString(json.offer_id, 'offer_id'),
      optionalString(json.offer_type, 'offer_type'),
    );
  }
}

export class AppActorTokenBalance {
  constructor(
    public readonly renewable: number,
    public readonly nonRenewable: number,
    public readonly total: number,
  ) {}

  static fromJson(json: JsonObject): AppActorTokenBalance {
    return new AppActorTokenBalance(
      optionalInteger(json.renewable, 'renewable') ?? 0,
      optionalInteger(json.non_renewable, 'non_renewable') ?? 0,
      optionalInteger(json.total, 'total') ?? 0,
    );
  }
}

export class AppActorEntitlementInfo {
  constructor(
    public readonly identifier: string,
    public readonly isActive: boolean,
    public readonly status?: string,
    public readonly productIdentifier?: string,
    public readonly grantedBy?: string,
    public readonly ownershipType: AppActorOwnershipType = AppActorOwnershipType.Unknown,
    public readonly periodType: AppActorPeriodType = AppActorPeriodType.Normal,
    public readonly willRenew = false,
    public readonly subscriptionStatus?: AppActorSubscriptionStatus,
    public readonly store: AppActorStore = AppActorStore.Unknown,
    public readonly basePlanId?: string,
    public readonly offerId?: string,
    public readonly isSandbox?: boolean,
    public readonly cancellationReason?: AppActorCancellationReason,
    public readonly purchaseDate?: string,
    public readonly startsAt?: string,
    public readonly latestPurchaseDate?: string,
    public readonly originalPurchaseDate?: string,
    public readonly expirationDate?: string,
    public readonly gracePeriodExpiresAt?: string,
    public readonly billingIssueDetectedAt?: string,
    public readonly unsubscribeDetectedAt?: string,
    public readonly renewedAt?: string,
    public readonly activePromotionalOfferType?: string,
    public readonly activePromotionalOfferId?: string,
  ) {}

  static fromJson(json: JsonObject): AppActorEntitlementInfo {
    return new AppActorEntitlementInfo(
      optionalString(json.identifier, 'identifier') ?? '',
      optionalBoolean(json.is_active, 'is_active') ?? false,
      optionalString(json.status, 'status'),
      optionalString(json.product_identifier, 'product_identifier'),
      optionalString(json.granted_by, 'granted_by'),
      parseOwnershipType(optionalString(json.ownership_type, 'ownership_type')),
      parsePeriodType(optionalString(json.period_type, 'period_type') ?? AppActorPeriodType.Normal),
      optionalBoolean(json.will_renew, 'will_renew') ?? false,
      optionalEnum(json.subscription_status, 'subscription_status', parseSubscriptionStatus),
      parseStore(optionalString(json.store, 'store')),
      optionalString(json.base_plan_id, 'base_plan_id'),
      optionalString(json.offer_id, 'offer_id'),
      optionalBoolean(json.is_sandbox, 'is_sandbox'),
      optionalEnum(json.cancellation_reason, 'cancellation_reason', parseCancellationReason),
      optionalString(json.purchase_date, 'purchase_date'),
      optionalString(json.starts_at, 'starts_at'),
      optionalString(json.latest_purchase_date, 'latest_purchase_date'),
      optionalString(json.original_purchase_date, 'original_purchase_date'),
      optionalString(json.expiration_date, 'expiration_date'),
      optionalString(json.grace_period_expires_at, 'grace_period_expires_at'),
      optionalString(json.billing_issue_detected_at, 'billing_issue_detected_at'),
      optionalString(json.unsubscribe_detected_at, 'unsubscribe_detected_at'),
      optionalString(json.renewed_at, 'renewed_at'),
      optionalString(json.active_promotional_offer_type, 'active_promotional_offer_type'),
      optionalString(json.active_promotional_offer_id, 'active_promotional_offer_id'),
    );
  }
}

export class AppActorSubscriptionInfo {
  constructor(
    public readonly subscriptionKey: string,
    public readonly productIdentifier: string,
    public readonly store: AppActorStore = AppActorStore.Unknown,
    public readonly basePlanId?: string,
    public readonly offerId?: string,
    public readonly isActive = false,
    public readonly expiresDate?: string,
    public readonly purchaseDate?: string,
    public readonly startsAt?: string,
    public readonly periodType?: AppActorPeriodType,
    public readonly status?: string,
    public readonly autoRenew?: boolean,
    public readonly isSandbox?: boolean,
    public readonly gracePeriodExpiresAt?: string,
    public readonly unsubscribeDetectedAt?: string,
    public readonly cancellationReason?: AppActorCancellationReason,
    public readonly renewedAt?: string,
    public readonly originalTransactionId?: string,
    public readonly latestTransactionId?: string,
    public readonly activePromotionalOfferType?: string,
    public readonly activePromotionalOfferId?: string,
  ) {}

  static fromJson(json: JsonObject): AppActorSubscriptionInfo {
    return new AppActorSubscriptionInfo(
      optionalString(json.subscription_key, 'subscription_key') ?? '',
      optionalString(json.product_identifier, 'product_identifier') ?? '',
      parseStore(optionalString(json.store, 'store')),
      optionalString(json.base_plan_id, 'base_plan_id'),
      optionalString(json.offer_id, 'offer_id'),
      optionalBoolean(json.is_active, 'is_active') ?? false,
      optionalString(json.expires_date, 'expires_date'),
      optionalString(json.purchase_date, 'purchase_date'),
      optionalString(json.starts_at, 'starts_at'),
      optionalEnum(json.period_type, 'period_type', parsePeriodType),
      optionalString(json.status, 'status'),
      optionalBoolean(json.auto_renew, 'auto_renew'),
      optionalBoolean(json.is_sandbox, 'is_sandbox'),
      optionalString(json.grace_period_expires_at, 'grace_period_expires_at'),
      optionalString(json.unsubscribe_detected_at, 'unsubscribe_detected_at'),
      optionalEnum(json.cancellation_reason, 'cancellation_reason', parseCancellationReason),
      optionalString(json.renewed_at, 'renewed_at'),
      optionalString(json.original_transaction_id, 'original_transaction_id'),
      optionalString(json.latest_transaction_id, 'latest_transaction_id'),
      optionalString(json.active_promotional_offer_type, 'active_promotional_offer_type'),
      optionalString(json.active_promotional_offer_id, 'active_promotional_offer_id'),
    );
  }
}

export class AppActorNonSubscription {
  constructor(
    public readonly productIdentifier: string,
    public readonly store: AppActorStore = AppActorStore.Unknown,
    public readonly basePlanId?: string,
    public readonly offerId?: string,
    public readonly originalTransactionIdentifier?: string,
    public readonly purchaseDate?: string,
    public readonly storeTransactionIdentifier?: string,
    public readonly isSandbox?: boolean,
    public readonly isConsumable?: boolean,
    public readonly isRefund?: boolean,
  ) {}

  static fromJson(json: JsonObject): AppActorNonSubscription {
    return new AppActorNonSubscription(
      optionalString(json.product_identifier, 'product_identifier') ?? '',
      parseStore(optionalString(json.store, 'store')),
      optionalString(json.base_plan_id, 'base_plan_id'),
      optionalString(json.offer_id, 'offer_id'),
      optionalString(json.original_transaction_identifier, 'original_transaction_identifier'),
      optionalString(json.purchase_date, 'purchase_date'),
      optionalString(json.store_transaction_identifier, 'store_transaction_identifier'),
      optionalBoolean(json.is_sandbox, 'is_sandbox'),
      optionalBoolean(json.is_consumable, 'is_consumable'),
      optionalBoolean(json.is_refund, 'is_refund'),
    );
  }
}

export class AppActorCustomerInfo {
  constructor(
    public readonly entitlements: JsonMap<AppActorEntitlementInfo> = {},
    public readonly subscriptions: JsonMap<AppActorSubscriptionInfo> = {},
    public readonly nonSubscriptions: JsonMap<AppActorNonSubscription[]> = {},
    public readonly consumableBalances?: JsonMap<number>,
    public readonly tokenBalance?: AppActorTokenBalance,
    public readonly snapshotDate?: string,
    public readonly appUserId?: string,
    public readonly requestId?: string,
    public readonly requestDate?: string,
    public readonly firstSeen?: string,
    public readonly lastSeen?: string,
    public readonly managementUrl?: string,
    public readonly isComputedOffline = false,
    public readonly productEntitlements: JsonMap<string[]> = {},
    public readonly activeEntitlementKeys: Set<string> = new Set(),
    public readonly verification = AppActorVerificationResult.NotRequested,
  ) {}

  get activeEntitlements(): JsonMap<AppActorEntitlementInfo> {
    return fromEntries(Object.entries(this.entitlements).filter(([, value]) => value.isActive));
  }

  hasActiveEntitlement(key: string): boolean {
    return this.activeEntitlementKeys.has(key);
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorCustomerInfo && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorCustomerInfo {
    return new AppActorCustomerInfo(
      mapValues(json.entitlements, AppActorEntitlementInfo.fromJson),
      mapValues(json.subscriptions, AppActorSubscriptionInfo.fromJson),
      mapListValues(json.non_subscriptions, AppActorNonSubscription.fromJson),
      optionalRecordOf(json.consumable_balances, 'consumable_balances', requireInteger),
      optionalObject(json.token_balance, 'token_balance', AppActorTokenBalance.fromJson),
      optionalString(json.snapshot_date, 'snapshot_date'),
      optionalString(json.app_user_id, 'app_user_id'),
      optionalString(json.request_id, 'request_id'),
      optionalString(json.request_date, 'request_date'),
      optionalString(json.first_seen, 'first_seen'),
      optionalString(json.last_seen, 'last_seen'),
      optionalString(json.management_url, 'management_url'),
      optionalBoolean(json.is_computed_offline, 'is_computed_offline') ?? false,
      mapStringLists(json.product_entitlements),
      new Set(optionalStringArray(json.active_entitlement_keys, 'active_entitlement_keys')),
      parseVerificationResult(optionalString(json.verification, 'verification')),
    );
  }
}

export class AppActorPackage {
  constructor(
    public readonly id: string,
    public readonly packageType: AppActorPackageType,
    public readonly productId: string,
    public readonly storeProductId?: string,
    public readonly productType = AppActorProductType.Unknown,
    public readonly store = AppActorStore.Unknown,
    public readonly basePlanId?: string,
    public readonly offerId?: string,
    public readonly localizedPriceString?: string,
    public readonly priceAmountMicros?: number,
    public readonly price?: number,
    public readonly currencyCode?: string,
    public readonly displayName?: string,
    public readonly productName?: string,
    public readonly productDescription?: string,
    public readonly metadata?: Record<string, string>,
    public readonly tokenAmount?: number,
    public readonly position?: number,
    public readonly serverId?: string,
    public readonly offeringId?: string,
  ) {}

  toPurchaseParams(): JsonObject {
    return {
      package_id: this.id,
      ...(this.storeProductId != null ? { store_product_id: this.storeProductId } : {}),
      product_id: this.productId,
      product_type: this.productType,
      store: this.store,
      ...(this.basePlanId != null ? { base_plan_id: this.basePlanId } : {}),
      ...(this.offerId != null ? { offer_id: this.offerId } : {}),
      ...(this.offeringId != null ? { offering_id: this.offeringId } : {}),
    };
  }

  toJson(): JsonObject {
    return this.toPurchaseParams();
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorPackage && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorPackage {
    return new AppActorPackage(
      optionalString(json.id, 'id') ?? '',
      parsePackageType(optionalString(json.package_type, 'package_type')),
      optionalString(json.product_id, 'product_id') ?? '',
      optionalString(json.store_product_id, 'store_product_id'),
      parseProductType(optionalString(json.product_type, 'product_type')),
      parseStore(optionalString(json.store, 'store')),
      optionalString(json.base_plan_id, 'base_plan_id'),
      optionalString(json.offer_id, 'offer_id'),
      optionalString(json.localized_price_string, 'localized_price_string'),
      optionalInteger(json.price_amount_micros, 'price_amount_micros'),
      optionalNumber(json.price, 'price'),
      optionalString(json.currency_code, 'currency_code'),
      optionalString(json.display_name, 'display_name'),
      optionalString(json.product_name, 'product_name'),
      optionalString(json.product_description, 'product_description'),
      optionalRecordOf(json.metadata, 'metadata', requireString),
      optionalInteger(json.token_amount, 'token_amount'),
      optionalInteger(json.position, 'position'),
      optionalString(json.server_id, 'server_id'),
      optionalString(json.offering_id, 'offering_id'),
    );
  }
}

export class AppActorOffering {
  constructor(
    public readonly id: string,
    public readonly displayName: string,
    public readonly isCurrent = false,
    public readonly lookupKey?: string,
    public readonly metadata?: Record<string, string>,
    public readonly packages: AppActorPackage[] = [],
  ) {}

  /**
   * The developer-defined key of this offering — the "lookup key" in the
   * dashboard, e.g. `'onboarding'`. Falls back to `id` when the offering has no key.
   */
  get offeringKey(): string {
    return this.lookupKey ?? this.id;
  }

  package(id: string): AppActorPackage | undefined {
    return this.packages.find((item) => item.id === id);
  }

  packageFor(type: AppActorPackageType): AppActorPackage | undefined {
    return this.packages.find((item) => item.packageType === type);
  }

  get weekly(): AppActorPackage | undefined {
    return this.packageFor(AppActorPackageType.Weekly);
  }

  get monthly(): AppActorPackage | undefined {
    return this.packageFor(AppActorPackageType.Monthly);
  }

  get twoMonth(): AppActorPackage | undefined {
    return this.packageFor(AppActorPackageType.TwoMonth);
  }

  get threeMonth(): AppActorPackage | undefined {
    return this.packageFor(AppActorPackageType.ThreeMonth);
  }

  get sixMonth(): AppActorPackage | undefined {
    return this.packageFor(AppActorPackageType.SixMonth);
  }

  get annual(): AppActorPackage | undefined {
    return this.packageFor(AppActorPackageType.Annual);
  }

  get lifetime(): AppActorPackage | undefined {
    return this.packageFor(AppActorPackageType.Lifetime);
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorOffering && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorOffering {
    return new AppActorOffering(
      optionalString(json.id, 'id') ?? '',
      optionalString(json.display_name, 'display_name') ?? '',
      optionalBoolean(json.is_current, 'is_current') ?? false,
      optionalString(json.lookup_key, 'lookup_key'),
      optionalRecordOf(json.metadata, 'metadata', requireString),
      asObjectArray(json.packages, 'packages', AppActorPackage.fromJson),
    );
  }
}

export class AppActorOfferings {
  constructor(
    public readonly current: AppActorOffering | null = null,
    public readonly all: JsonMap<AppActorOffering> = {},
    public readonly productEntitlements: JsonMap<string[]> = {},
    public readonly verification = AppActorVerificationResult.NotRequested,
  ) {}

  /** Every offering as a list: the current one first, then by `offeringKey`. */
  get allOfferings(): AppActorOffering[] {
    return Object.values(this.all).sort((a, b) =>
      a.isCurrent !== b.isCurrent ? (a.isCurrent ? -1 : 1) : compareCodeUnits(a.offeringKey, b.offeringKey),
    );
  }

  offering(id: string): AppActorOffering | undefined {
    return ownValue(this.all, id);
  }

  /**
   * Returns the offering with the given `offeringKey`, or `undefined`.
   *
   * ```ts
   * const onboarding = offerings.getOffering('onboarding');
   * ```
   */
  getOffering(offeringKey: string): AppActorOffering | undefined {
    return Object.values(this.all).find((item) => item.offeringKey === offeringKey);
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorOfferings && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorOfferings {
    return new AppActorOfferings(
      optionalObject(json.current, 'current', AppActorOffering.fromJson) ?? null,
      mapValues(json.all, AppActorOffering.fromJson),
      mapStringLists(json.product_entitlements),
      parseVerificationResult(optionalString(json.verification, 'verification')),
    );
  }
}

export class AppActorPurchaseInfo {
  constructor(
    public readonly store: AppActorStore,
    public readonly productId?: string,
    public readonly transactionId?: string,
    public readonly originalTransactionId?: string,
    public readonly purchaseDate?: string,
    public readonly isSandbox?: boolean,
  ) {}

  static fromJson(json: JsonObject): AppActorPurchaseInfo {
    return new AppActorPurchaseInfo(
      parseStore(optionalString(json.store, 'store')),
      optionalString(json.product_id, 'product_id'),
      optionalString(json.transaction_id, 'transaction_id'),
      optionalString(json.original_transaction_id, 'original_transaction_id'),
      optionalString(json.purchase_date, 'purchase_date'),
      optionalBoolean(json.is_sandbox, 'is_sandbox'),
    );
  }
}

export class AppActorPurchaseResult {
  constructor(
    public readonly status: AppActorPurchaseStatus,
    public readonly customerInfo?: AppActorCustomerInfo,
    public readonly purchaseInfo?: AppActorPurchaseInfo,
  ) {}

  get isPurchased(): boolean {
    return this.status === AppActorPurchaseStatus.Purchased;
  }

  get isCancelled(): boolean {
    return this.status === AppActorPurchaseStatus.Cancelled;
  }

  get isPending(): boolean {
    return this.status === AppActorPurchaseStatus.Pending;
  }

  get isRestored(): boolean {
    return this.status === AppActorPurchaseStatus.Restored;
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorPurchaseResult && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorPurchaseResult {
    return new AppActorPurchaseResult(
      parsePurchaseStatus(optionalString(json.status, 'status')),
      optionalObject(json.customer_info, 'customer_info', AppActorCustomerInfo.fromJson),
      optionalObject(json.purchase_info, 'purchase_info', AppActorPurchaseInfo.fromJson),
    );
  }
}

export class AppActorRemoteConfigItem {
  constructor(
    public readonly key: string,
    public readonly value: unknown,
    public readonly valueType: AppActorConfigValueType,
  ) {}

  get stringValue(): string | undefined {
    return asString(this.value);
  }

  get boolValue(): boolean | undefined {
    return asBoolean(this.value);
  }

  get numberValue(): number | undefined {
    return typeof this.value === 'number' ? this.value : undefined;
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorRemoteConfigItem && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorRemoteConfigItem {
    return new AppActorRemoteConfigItem(
      optionalString(json.key, 'key') ?? '',
      json.value,
      parseConfigValueType(optionalString(json.value_type, 'value_type') ?? AppActorConfigValueType.String),
    );
  }
}

export class AppActorRemoteConfigs {
  constructor(public readonly items: AppActorRemoteConfigItem[] = []) {}

  get(key: string): AppActorRemoteConfigItem | undefined {
    return this.items.find((item) => item.key === key);
  }

  equals(other: unknown): boolean {
    return other instanceof AppActorRemoteConfigs && appActorModelEquals(this, other);
  }

  static fromJson(json: JsonObject): AppActorRemoteConfigs {
    return new AppActorRemoteConfigs(asObjectArray(json.items, 'items', AppActorRemoteConfigItem.fromJson));
  }
}

export class AppActorDeferredPurchaseEvent {
  constructor(
    public readonly productId: string,
    public readonly customerInfo: AppActorCustomerInfo,
  ) {}

  static fromJson(json: JsonObject): AppActorDeferredPurchaseEvent {
    return new AppActorDeferredPurchaseEvent(
      optionalString(json.product_id, 'product_id') ?? '',
      AppActorCustomerInfo.fromJson(
        json.customer_info == null ? {} : requireRecord(json.customer_info, 'customer_info'),
      ),
    );
  }
}
