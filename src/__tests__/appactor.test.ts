import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NativeEvent, NativeListener, NativeRegistration } from './support';
import { emitNativeEvent as emitSharedNativeEvent, methodsCalled, success } from './support';

import {
  AppActor,
  appActorCapacitorVersion,
  AppActorAsaDiagnostics,
  AppActorAsaOptions,
  AppActorAttributeValue,
  AppActorAttribution,
  AppActorAttributionProvider,
  AppActorAttributionStatus,
  appActorAttributionProviderFromString,
  appActorAttributionProviderWireValue,
  appActorAttributionStatusFromString,
  AppActorCustomerInfo,
  AppActorDeferredPurchaseEvent,
  AppActorError,
  AppActorConfigValueType,
  AppActorEntitlementInfo,
  AppActorExperimentAssignment,
  AppActorIntegrationIdentifier,
  appActorIntegrationIdentifierFromString,
  AppActorLogLevel,
  AppActorOptions,
  AppActorOfferings,
  AppActorPackage,
  AppActorPackageType,
  appActorPackageTypeFromString,
  appActorPackageTypeWireValue,
  appActorModelEquals,
  AppActorPlatformKeys,
  AppActorReceiptPipelineEvent,
  AppActorPurchaseIntent,
  AppActorPurchaseResult,
  AppActorProductType,
  AppActorPurchaseStatus,
  appActorPurchaseStatusFromString,
  AppActorRemoteConfigItem,
  AppActorRemoteConfigs,
  AppActorStoreCapability,
  appActorStoreCapabilityFromString,
  appActorStoreCapabilityWireValue,
  AppActorStore,
  appActorStoreFromString,
  appActorStoreWireValue,
  AppActorStorefront,
  AppActorSubscriptionReplacementMode,
  appActorSubscriptionReplacementModeFromString,
  AppActorSubscriptionInfo,
  AppActorTokenBalance,
  AppActorVerificationResult,
  appActorVerificationResultIsVerified,
  appActorVerificationResultWireValue,
  UnsupportedError,
} from '../index';

type ExecuteFn = (method: string, payload: string) => Promise<string | null>;

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  debug: true,
  execute: vi.fn<ExecuteFn>(),
  nativeListeners: [] as NativeRegistration[],
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mocks.platform,
    get DEBUG() {
      return mocks.debug;
    },
  },
  registerPlugin: () => ({
    execute: async ({ method, payload }: { method: string; payload: string }) => ({
      response: await mocks.execute(method, payload),
    }),
    addListener: async (eventName: string, listener: NativeListener) => {
      const registration: NativeRegistration = { eventName, listener };
      mocks.nativeListeners.push(registration);
      return {
        remove: async () => {
          registration.removed = true;
        },
      };
    },
  }),
  WebPlugin: class {},
}));

const mockExecute = mocks.execute;

function emitNativeEvent(event: NativeEvent): void {
  emitSharedNativeEvent(mocks.nativeListeners, event);
}

const subscriptions: Array<{ remove: () => void }> = [];

function track(subscription: { remove: () => void }): void {
  subscriptions.push(subscription);
}

function testPackage(json: Record<string, unknown> = {}): AppActorPackage {
  return AppActorPackage.fromJson({
    id: 'monthly',
    package_type: 'monthly',
    product_id: 'com.app.monthly',
    product_type: 'subscription',
    store: 'app_store',
    ...json,
  });
}

describe('AppActor Capacitor', () => {
  beforeEach(async () => {
    mockExecute.mockReset();
    mocks.platform = 'ios';
    mocks.debug = true;
    mockExecute.mockResolvedValue(success(null));
    await AppActor.instance.reset();
    mockExecute.mockClear();
  });

  afterEach(() => {
    subscriptions.splice(0).forEach((subscription) => subscription.remove());
  });

  it('configures with wrapper platform info and staged ASA on iOS', async () => {
    AppActor.instance.enableSearchAdsTracking();
    await AppActor.instance.configure('pk_test_123', {
      options: new AppActorOptions(AppActorLogLevel.Debug),
    });

    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      'configure',
      JSON.stringify({
        api_key: 'pk_test_123',
        options: {
          log_level: 'debug',
          platform_info: { flavor: 'capacitor', version: appActorCapacitorVersion },
        },
      }),
    );
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      'enable_apple_search_ads_tracking',
      JSON.stringify({
        auto_track_purchases: true,
        track_in_sandbox: false,
        debug_mode: false,
      }),
    );
  });

  it('accepts direct ASA options before configure, like Flutter', async () => {
    AppActor.instance.enableSearchAdsTracking(new AppActorAsaOptions(false, true, true));
    await AppActor.instance.configure('pk_test_123');

    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      'enable_apple_search_ads_tracking',
      JSON.stringify({
        auto_track_purchases: false,
        track_in_sandbox: true,
        debug_mode: true,
      }),
    );
  });

  it('selects platform keys for Android and does not run ASA there', async () => {
    mocks.platform = 'android';
    AppActor.instance.enableSearchAdsTracking();
    await AppActor.instance.configure(new AppActorPlatformKeys('pk_ios', 'pk_android'));

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(
      'configure',
      JSON.stringify({
        api_key: 'pk_android',
        options: {
          platform_info: { flavor: 'capacitor', version: appActorCapacitorVersion },
        },
      }),
    );
  });

  it('rejects platform keys on unsupported platforms with UnsupportedError', async () => {
    mocks.platform = 'web';

    await expect(AppActor.instance.configure(new AppActorPlatformKeys('pk_ios', 'pk_android'))).rejects.toBeInstanceOf(
      UnsupportedError,
    );
  });

  it('forwards empty-string appUserId like Flutter', async () => {
    await AppActor.instance.configure('pk_test_123', {
      appUserId: '',
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'configure',
      JSON.stringify({
        api_key: 'pk_test_123',
        app_user_id: '',
        options: {
          platform_info: { flavor: 'capacitor', version: appActorCapacitorVersion },
        },
      }),
    );
  });

  it('keeps customer info events flowing after reset and reconfigure', async () => {
    const listener = vi.fn();
    track(AppActor.instance.onCustomerInfoUpdated.listen(listener));

    await AppActor.instance.configure('pk_test_123');
    await AppActor.instance.reset();
    await AppActor.instance.configure('pk_test_123');

    emitNativeEvent({
      name: 'customer_info_updated',
      json: JSON.stringify({
        app_user_id: 'user_reset_123',
      }),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        appUserId: 'user_reset_123',
      }),
    );
  });

  it('serializes purchasePackage with quantity and trimmed placement', async () => {
    mockExecute.mockResolvedValue(success({ status: 'success' }));

    const pkg = testPackage();

    const result = await AppActor.instance.purchasePackage(pkg, {
      quantity: 3,
      placement: '  onboarding_paywall  ',
    });

    expect(result.status).toBe(AppActorPurchaseStatus.Purchased);
    expect(mockExecute).toHaveBeenCalledWith(
      'purchase_package',
      JSON.stringify({
        package_id: 'monthly',
        quantity: 3,
        placement: 'onboarding_paywall',
      }),
    );
  });

  it('purchasePackage omits null placement from the native payload', async () => {
    mockExecute.mockResolvedValue(success({ status: 'success' }));

    await AppActor.instance.purchasePackage(testPackage(), {
      placement: null,
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'purchase_package',
      JSON.stringify({
        package_id: 'monthly',
      }),
    );
  });

  it('purchasePackage omits blank placement from the native payload', async () => {
    mockExecute.mockResolvedValue(success({ status: 'success' }));

    await AppActor.instance.purchasePackage(testPackage(), {
      placement: '   ',
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'purchase_package',
      JSON.stringify({
        package_id: 'monthly',
      }),
    );
  });

  it('purchasePackage serializes max length placement', async () => {
    mockExecute.mockResolvedValue(success({ status: 'success' }));

    const placement = 'x'.repeat(255);
    await AppActor.instance.purchasePackage(testPackage(), {
      placement,
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'purchase_package',
      JSON.stringify({
        package_id: 'monthly',
        placement,
      }),
    );
  });

  it('purchasePackage omits overlong placement from the native payload', async () => {
    mockExecute.mockResolvedValue(success({ status: 'success' }));

    await AppActor.instance.purchasePackage(testPackage(), {
      placement: 'x'.repeat(256),
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'purchase_package',
      JSON.stringify({
        package_id: 'monthly',
      }),
    );
  });

  it('purchasePackage rejects invalid quantity before native dispatch', async () => {
    await expect(AppActor.instance.purchasePackage(testPackage(), { quantity: 0 })).rejects.toThrow(
      'Purchase quantity must be at least 1.',
    );

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('purchasePackage rejects non-integer quantity before native dispatch', async () => {
    for (const q of [1.5, NaN, Infinity]) {
      await expect(AppActor.instance.purchasePackage(testPackage(), { quantity: q })).rejects.toThrow(
        'Purchase quantity must be an integer.',
      );
    }

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('serializes empty-string optional package identifiers when non-null', () => {
    const pkg = testPackage({
      store_product_id: '',
      base_plan_id: '',
      offer_id: '',
      offering_id: '',
    });

    expect(pkg.toPurchaseParams()).toEqual({
      package_id: 'monthly',
      store_product_id: '',
      product_id: 'com.app.monthly',
      product_type: 'subscription',
      store: 'app_store',
      base_plan_id: '',
      offer_id: '',
      offering_id: '',
    });
  });

  it('purchasePackage forwards empty-string offering id when non-null', async () => {
    mockExecute.mockResolvedValue(success({ status: 'success' }));

    await AppActor.instance.purchasePackage(testPackage({ offering_id: '' }));

    expect(mockExecute).toHaveBeenCalledWith(
      'purchase_package',
      JSON.stringify({
        package_id: 'monthly',
        offering_id: '',
      }),
    );
  });

  it('serializes restorePurchases with syncWithAppStore when provided', async () => {
    mockExecute.mockResolvedValue(success({ app_user_id: 'user_restore_123' }));

    const result = await AppActor.instance.restorePurchases({
      syncWithAppStore: true,
    });

    expect(result.appUserId).toBe('user_restore_123');
    expect(mockExecute).toHaveBeenCalledWith(
      'restore_purchases',
      JSON.stringify({
        sync_with_app_store: true,
      }),
    );
  });

  it('normalizes custom attributes before native dispatch', async () => {
    await AppActor.instance.setAttributes({
      plan: AppActorAttributeValue.string('pro'),
      flags: AppActorAttributeValue.boolList([true, false]),
      last_seen: new Date('2026-05-16T12:00:00.000Z'),
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'set_attributes',
      JSON.stringify({
        attributes: {
          plan: 'pro',
          flags: [true, false],
          last_seen: {
            value: '2026-05-16T12:00:00.000Z',
            valueType: 'date',
          },
        },
      }),
    );
  });

  it('accepts iterable attribute entries like Map', async () => {
    await AppActor.instance.setAttributes(
      new Map<string, unknown>([
        ['plan', 'pro'],
        ['trial', true],
        ['last_seen', new Date('2026-05-16T12:00:00.000Z')],
      ]),
    );

    expect(mockExecute).toHaveBeenCalledWith(
      'set_attributes',
      JSON.stringify({
        attributes: {
          plan: 'pro',
          trial: true,
          last_seen: {
            value: '2026-05-16T12:00:00.000Z',
            valueType: 'date',
          },
        },
      }),
    );
  });

  it('accepts primitive iterable attribute values like Set', async () => {
    await AppActor.instance.setAttributes({
      eligible_products: new Set(['monthly', 'annual']),
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'set_attributes',
      JSON.stringify({
        attributes: {
          eligible_products: ['monthly', 'annual'],
        },
      }),
    );
  });

  it('accepts iterable attribution metadata entries like Map', () => {
    const attribution = new AppActorAttribution({
      provider: AppActorAttributionProvider.Adjust,
      metadata: new Map<string, unknown>([
        ['campaign_weight', 1.5],
        ['captured_at', new Date('2026-05-16T12:00:00.000Z')],
      ]),
    });

    expect(attribution.toJson()).toEqual({
      provider: 'adjust',
      metadata: {
        campaign_weight: 1.5,
        captured_at: {
          value: '2026-05-16T12:00:00.000Z',
          valueType: 'date',
        },
      },
    });
  });

  it('accepts primitive iterable attribution metadata values like Set', () => {
    const attribution = new AppActorAttribution({
      provider: AppActorAttributionProvider.Adjust,
      metadata: {
        platforms: new Set(['ios', 'android']),
      },
    });

    expect(attribution.toJson()).toEqual({
      provider: 'adjust',
      metadata: {
        platforms: ['ios', 'android'],
      },
    });
  });

  it('accepts Flutter-style attribution init objects', () => {
    const attribution = new AppActorAttribution({
      provider: AppActorAttributionProvider.AppleSearchAds,
      campaignName: 'spring_sale',
      adGroup: 'brand_search',
      attributedAt: new Date('2026-05-16T12:00:00.000Z'),
      metadata: {
        source: 'capacitor',
      },
    });

    expect(attribution.toJson()).toEqual({
      provider: 'apple_search_ads',
      campaign_name: 'spring_sale',
      ad_group: 'brand_search',
      attributed_at: '2026-05-16T12:00:00.000Z',
      metadata: {
        source: 'capacitor',
      },
    });
  });

  it('routes attribution bridge calls with direct payloads and explicit clears', async () => {
    await AppActor.instance.updateAttribution(
      new AppActorAttribution({
        provider: AppActorAttributionProvider.Meta,
        source: 'facebook',
        campaign: 'spring_sale',
        metadata: {
          rank: 2,
        },
      }),
    );
    await AppActor.instance.setMediaSource('facebook');
    await AppActor.instance.setCampaign(null);
    await AppActor.instance.setCreative('video_a');

    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      'update_attribution',
      JSON.stringify({
        provider: 'meta',
        source: 'facebook',
        campaign: 'spring_sale',
        metadata: {
          rank: 2,
        },
      }),
    );
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'set_media_source', JSON.stringify({ value: 'facebook' }));
    expect(mockExecute).toHaveBeenNthCalledWith(3, 'set_campaign', JSON.stringify({ value: null }));
    expect(mockExecute).toHaveBeenNthCalledWith(4, 'set_creative', JSON.stringify({ value: 'video_a' }));
  });

  it('custom attribute keys reject reserved prefixes before native dispatch', async () => {
    const cases: Array<() => Promise<void>> = [
      () => AppActor.instance.setAttribute('', 'x'),
      () => AppActor.instance.setAttribute('$email', 'x'),
      () => AppActor.instance.setAttribute('appactor.source', 'x'),
      () => AppActor.instance.setAttribute('integration.adjust_id', 'x'),
      () => AppActor.instance.setAttribute('appVersion', 'x'),
      () => AppActor.instance.setAttribute('platform', 'x'),
      () => AppActor.instance.setAttribute('userCountry', 'x'),
      () => AppActor.instance.setAttributes({ 'AppActor.source': 'x' }),
      () => AppActor.instance.setAttribute('x'.repeat(65), 'x'),
      () => AppActor.instance.setAttribute('bad key', 'x'),
    ];

    for (const run of cases) {
      await expect(run()).rejects.toThrow();
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('attribute values reject backend-incompatible shapes before native dispatch', async () => {
    const cases: Array<() => Promise<void>> = [
      () => AppActor.instance.setAttribute('score', Number.NaN),
      () => AppActor.instance.setAttributes({ nested: { value: true } }),
      () => AppActor.instance.setAttribute('mixed_array', ['a', 1]),
      () =>
        AppActor.instance.setAttribute(
          'too_many',
          Array.from({ length: 21 }, (_, index) => `item_${index}`),
        ),
    ];

    for (const run of cases) {
      await expect(run()).rejects.toThrow();
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('attribution canonical fields and metadata keys validate before native dispatch', async () => {
    const cases: Array<() => Promise<void>> = [
      () =>
        AppActor.instance.updateAttribution(
          new AppActorAttribution({
            provider: AppActorAttributionProvider.Custom,
            providerName: ' facebook',
          }),
        ),
      () =>
        AppActor.instance.updateAttribution(
          new AppActorAttribution({
            provider: AppActorAttributionProvider.Custom,
            campaignName: 'x'.repeat(1025),
          }),
        ),
      () =>
        AppActor.instance.updateAttribution(
          new AppActorAttribution({
            provider: AppActorAttributionProvider.Custom,
            metadata: { 'appactor.private': 'x' },
          }),
        ),
      () =>
        AppActor.instance.updateAttribution(
          new AppActorAttribution({
            provider: AppActorAttributionProvider.Custom,
            metadata: { 'integration.adjust_id': 'x' },
          }),
        ),
    ];

    for (const run of cases) {
      await expect(run()).rejects.toThrow();
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('routes profile helpers through the native bridge', async () => {
    await AppActor.instance.setEmail('user@example.com');
    await AppActor.instance.setDisplayName('Ada Lovelace');
    await AppActor.instance.setPhoneNumber('+15551234567');
    await AppActor.instance.setPushToken('push-token-123');
    await AppActor.instance.collectDeviceIdentifiers();

    expect(methodsCalled(mockExecute)).toEqual([
      'set_email',
      'set_display_name',
      'set_phone_number',
      'set_push_token',
      'collect_device_identifiers',
    ]);
    expect(mockExecute).toHaveBeenNthCalledWith(1, 'set_email', JSON.stringify({ email: 'user@example.com' }));
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      'set_display_name',
      JSON.stringify({ display_name: 'Ada Lovelace' }),
    );
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      'set_phone_number',
      JSON.stringify({ phone_number: '+15551234567' }),
    );
    expect(mockExecute).toHaveBeenNthCalledWith(4, 'set_push_token', JSON.stringify({ push_token: 'push-token-123' }));
    expect(mockExecute).toHaveBeenNthCalledWith(5, 'collect_device_identifiers', JSON.stringify({}));
  });

  it('rejects invalid profile helper values before native dispatch', async () => {
    await expect(AppActor.instance.setEmail('bad-email')).rejects.toThrow('Email must be valid.');
    await expect(AppActor.instance.setPhoneNumber('abc')).rejects.toThrow('Phone number must be valid.');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('can clear integration identifiers through the native bridge', async () => {
    await AppActor.instance.unsetIntegrationIdentifier(AppActorIntegrationIdentifier.AdjustId);
    await AppActor.instance.unsetCustomIntegrationIdentifier('kochava_device_id');

    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      'set_integration_identifier',
      JSON.stringify({
        type: 'adjust_adid',
        value: null,
      }),
    );
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      'set_integration_identifier',
      JSON.stringify({
        type: 'kochava_device_id',
        value: null,
      }),
    );
  });

  it('maps transport failures into AppActorError', async () => {
    mockExecute.mockRejectedValue(new Error('bridge exploded'));

    await expect(AppActor.instance.getCustomerInfo()).rejects.toMatchObject({
      code: 1099,
      message: 'bridge exploded',
    });
  });

  it('answers the Android-only storefront helper with null on iOS, like Flutter', async () => {
    const result = await AppActor.instance.getStorefront();
    expect(result).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('dispatches receipt events from the native emitter', async () => {
    const listener = vi.fn();
    track(AppActor.instance.onReceiptPipelineEvent.listen(listener));

    emitNativeEvent({
      name: 'receipt_pipeline_event',
      json: JSON.stringify({
        type: 'posted_ok',
        product_id: 'com.app.monthly',
        app_user_id: 'user_123',
      }),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'posted_ok',
        productId: 'com.app.monthly',
        appUserId: 'user_123',
      }),
    );
  });

  it('dispatches deferred purchase events from the native emitter', async () => {
    const listener = vi.fn();
    track(AppActor.instance.onDeferredPurchaseResolved.listen(listener));

    emitNativeEvent({
      name: 'deferred_purchase_resolved',
      json: JSON.stringify({
        product_id: 'com.app.monthly',
        customer_info: {
          app_user_id: 'user_123',
        },
      }),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'com.app.monthly',
        customerInfo: expect.objectContaining({
          appUserId: 'user_123',
        }),
      }),
    );
  });

  it('drops malformed native events like Flutter', async () => {
    const receiptListener = vi.fn();
    const logSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const invalidPayloads = ['{', '[]', 'null', '"oops"'];

    track(AppActor.instance.onReceiptPipelineEvent.listen(receiptListener));
    await AppActor.instance.configure('pk_test_123');

    for (const invalidPayload of invalidPayloads) {
      emitNativeEvent({
        name: 'receipt_pipeline_event',
        json: invalidPayload,
      });
      emitNativeEvent({
        name: 'sdk_log',
        json: invalidPayload,
      });
    }

    expect(receiptListener).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('surfaces sdk_log events for diagnostics listeners', async () => {
    const listener = vi.fn();
    track(AppActor.instance.onSdkLog.listen(listener));

    emitNativeEvent({
      name: 'sdk_log',
      json: JSON.stringify({
        level: 'debug',
        message: 'purchase sync finished',
        category: 'pipeline',
        timestamp: '2026-05-16T12:00:00.000Z',
      }),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        message: 'purchase sync finished',
        category: 'pipeline',
        timestamp: new Date('2026-05-16T12:00:00.000Z'),
      }),
    );
  });

  it('prints sdk_log events in debug mode even without a listener', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await AppActor.instance.configure('pk_test_123');

    emitNativeEvent({
      name: 'sdk_log',
      json: JSON.stringify({
        level: 'debug',
        message: 'purchase sync finished',
        category: 'pipeline',
      }),
    });

    expect(debugSpy).toHaveBeenCalledWith('[AppActor/DEBUG] pipeline: purchase sync finished');
    debugSpy.mockRestore();
  });

  it('reads iOS ASA helper values through the native bridge', async () => {
    mockExecute
      .mockResolvedValueOnce(success(3.9))
      .mockResolvedValueOnce(success(true))
      .mockResolvedValueOnce(success(false));

    await expect(AppActor.instance.getPendingAsaPurchaseEventCount()).resolves.toBe(3);
    await expect(AppActor.instance.getAsaFirstInstallOnDevice()).resolves.toBe(true);
    await expect(AppActor.instance.getAsaFirstInstallOnAccount()).resolves.toBe(false);

    expect(methodsCalled(mockExecute)).toEqual([
      'get_pending_asa_purchase_event_count',
      'get_asa_first_install_on_device',
      'get_asa_first_install_on_account',
    ]);
  });

  it('surfaces purchase-intent events and purchases them on iOS', async () => {
    mockExecute.mockResolvedValue(
      success({
        status: 'success',
        customer_info: {
          app_user_id: 'user_123',
        },
      }),
    );

    const listener = vi.fn();
    track(AppActor.instance.onPurchaseIntent.listen(listener));

    emitNativeEvent({
      name: 'purchase_intent_received',
      json: JSON.stringify({
        intent_id: 'intent_123',
        product_id: 'com.app.monthly',
        offer_id: 'offer_123',
        offer_type: 'intro7d',
      }),
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: 'intent_123',
        productId: 'com.app.monthly',
        offerId: 'offer_123',
        offerType: 'intro7d',
      }),
    );

    const result = await AppActor.instance.purchaseFromIntent(
      new AppActorPurchaseIntent('intent_123', 'com.app.monthly', 'offer_123', 'intro7d'),
    );

    expect(result.status).toBe(AppActorPurchaseStatus.Purchased);
    expect(result.customerInfo?.appUserId).toBe('user_123');
    expect(mockExecute).toHaveBeenCalledWith(
      'purchase_from_intent',
      JSON.stringify({
        intent_id: 'intent_123',
      }),
    );
  });

  it('throws UnsupportedError for iOS-only helpers on Android', async () => {
    mocks.platform = 'android';

    await expect(AppActor.instance.presentOfferCodeRedeemSheet()).rejects.toBeInstanceOf(UnsupportedError);
    await expect(
      AppActor.instance.purchaseFromIntent(new AppActorPurchaseIntent('intent_123', 'product_123')),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });

  it('exposes getRemoteConfigInt only for integral numbers', async () => {
    mockExecute
      .mockResolvedValueOnce(success({ key: 'whole', value: 5, value_type: 'number' }))
      .mockResolvedValueOnce(success({ key: 'fraction', value: 5.25, value_type: 'number' }));

    await expect(AppActor.instance.getRemoteConfigInt('whole')).resolves.toBe(5);
    await expect(AppActor.instance.getRemoteConfigInt('fraction')).resolves.toBeNull();
  });

  it('keeps empty-string experiment assignments instead of treating them as null', async () => {
    mockExecute.mockResolvedValue(
      success({
        experiment_id: 'exp_empty',
        experiment_key: '',
        variant_id: 'variant_empty',
        variant_key: 'control',
        payload: 'fallback',
        value_type: 'string',
        assigned_at: '2026-05-16T12:00:00.000Z',
      }),
    );

    const assignment = await AppActor.instance.getExperimentAssignment('');

    expect(assignment).toEqual(
      expect.objectContaining({
        experimentId: 'exp_empty',
        experimentKey: '',
        variantKey: 'control',
      }),
    );
  });

  it('treats sync, quiet sync, and drain queue as distinct wire methods', async () => {
    mockExecute.mockResolvedValue(success({ app_user_id: 'user_123', active_entitlement_keys: ['premium'] }));

    await AppActor.instance.syncPurchases();
    await AppActor.instance.quietSyncPurchases();
    await AppActor.instance.drainReceiptQueueAndRefreshCustomer();

    expect(methodsCalled(mockExecute)).toEqual([
      'sync_purchases',
      'quiet_sync_purchases',
      'drain_receipt_queue_and_refresh_customer',
    ]);
  });

  it('parses structured native error envelopes into AppActorError', async () => {
    mockExecute.mockResolvedValue(
      JSON.stringify({
        error: {
          code: 2005,
          message: 'Network error',
          detail: 'transient=true',
        },
      }),
    );

    await expect(AppActor.instance.getCustomerInfo()).rejects.toEqual(
      expect.objectContaining({
        code: 2005,
        message: 'Network error',
        isTransient: true,
      }),
    );
  });

  it('parses enriched error fields', () => {
    const error = AppActorError.fromJson({
      code: 2007,
      message: 'Rate limited',
      detail: 'httpStatus=429, transient=true',
      request_id: 'req_abc123',
      scope: 'ip',
      retry_after_seconds: 30,
    });

    expect(error.requestId).toBe('req_abc123');
    expect(error.scope).toBe('ip');
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.isTransient).toBe(true);
    expect(error.isServer).toBe(true);
    expect(error.isNetwork).toBe(false);
    expect(
      AppActorError.fromJson({
        code: AppActorError.codeNotConfigured,
        message: 'Not configured',
      }).isNotConfigured,
    ).toBe(true);
    expect(
      AppActorError.fromJson({
        code: AppActorError.codeNetwork,
        message: 'Network',
      }).isNetwork,
    ).toBe(true);
    expect(
      AppActorError.fromJson({
        code: AppActorError.codeInvalidOffer,
        message: 'Invalid offer',
      }).isInvalidOffer,
    ).toBe(true);
    expect(
      AppActorError.fromJson({
        code: AppActorError.codePurchaseIneligible,
        message: 'Ineligible',
      }).isPurchaseIneligible,
    ).toBe(true);
    expect(
      AppActorError.fromJson({
        code: AppActorError.codePurchaseFailed,
        message: 'Purchase failed',
      }).isPurchaseFailed,
    ).toBe(true);
    expect(
      AppActorError.fromJson({
        code: AppActorError.codeSignatureVerification,
        message: 'Signature failed',
      }).isSignatureVerification,
    ).toBe(true);
    expect(() =>
      AppActorError.fromJson({
        message: 'Rate limited',
        retry_after_seconds: 'not_a_number',
      }),
    ).toThrow('retry_after_seconds must be a number.');
  });

  it('parses ASA diagnostics, storefront, remote configs, and deferred purchase models', () => {
    const diagnostics = AppActorAsaDiagnostics.fromJson({
      attribution_completed: true,
      pending_purchase_event_count: 2,
      debug_mode: true,
      auto_track_purchases: false,
      track_in_sandbox: true,
    });
    const storefront = AppActorStorefront.fromJson({
      store: 'playStore',
      country_code: 'TR',
    });
    const remoteConfigs = AppActorRemoteConfigs.fromJson({
      items: [
        {
          key: 'headline',
          value: 'hello',
          value_type: 'string',
        },
      ],
    });
    const deferred = AppActorDeferredPurchaseEvent.fromJson({
      product_id: 'com.app.monthly',
      customer_info: {
        app_user_id: 'user_123',
      },
    });

    expect(diagnostics).toEqual(
      expect.objectContaining({
        attributionCompleted: true,
        pendingPurchaseEventCount: 2,
        debugMode: true,
        autoTrackPurchases: false,
        trackInSandbox: true,
      }),
    );
    expect(storefront).toEqual(
      expect.objectContaining({
        store: AppActorStore.PlayStore,
        countryCode: 'TR',
      }),
    );
    expect(remoteConfigs.get('headline')?.stringValue).toBe('hello');
    expect(deferred).toEqual(
      expect.objectContaining({
        productId: 'com.app.monthly',
        customerInfo: expect.objectContaining({
          appUserId: 'user_123',
        }),
      }),
    );
  });

  it('truncates integer-semantic model fields like Flutter toInt()', () => {
    const error = AppActorError.fromJson({
      code: 2001.9,
      message: 'Not configured',
      retry_after_seconds: 3.75,
    });
    const diagnostics = AppActorAsaDiagnostics.fromJson({
      pending_purchase_event_count: 2.9,
    });
    const event = AppActorReceiptPipelineEvent.fromJson({
      retry_count: 4.8,
    });
    const balance = AppActorTokenBalance.fromJson({
      renewable: 10.9,
      non_renewable: -2.9,
      total: 8.4,
    });
    const customerInfo = AppActorCustomerInfo.fromJson({
      consumable_balances: {
        coins: 12.75,
      },
      token_balance: {
        renewable: 1.9,
        non_renewable: 2.9,
        total: 4.8,
      },
    });
    const pkg = AppActorPackage.fromJson({
      id: 'coins_100',
      package_type: 'consumable',
      product_id: 'com.app.coins100',
      price_amount_micros: 1990000.99,
      price: 1.99,
      token_amount: 100.75,
      position: 3.4,
    });

    expect(error.code).toBe(2001);
    expect(error.retryAfterSeconds).toBe(3.75);
    expect(diagnostics.pendingPurchaseEventCount).toBe(2);
    expect(event.retryCount).toBe(4);
    expect(balance).toEqual(
      expect.objectContaining({
        renewable: 10,
        nonRenewable: -2,
        total: 8,
      }),
    );
    expect(customerInfo.consumableBalances?.coins).toBe(12);
    expect(customerInfo.tokenBalance).toEqual(
      expect.objectContaining({
        renewable: 1,
        nonRenewable: 2,
        total: 4,
      }),
    );
    expect(pkg.priceAmountMicros).toBe(1990000);
    expect(pkg.price).toBe(1.99);
    expect(pkg.tokenAmount).toBe(100);
    expect(pkg.position).toBe(3);
  });

  it('throws for malformed scalar native payload fields like Flutter casts', async () => {
    expect(() =>
      AppActorError.fromJson({
        code: 2005,
        message: 42,
      }),
    ).toThrow('message must be a string.');
    expect(() =>
      AppActorAsaDiagnostics.fromJson({
        attribution_completed: 'true',
      }),
    ).toThrow('attribution_completed must be a boolean.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        app_user_id: 42,
      }),
    ).toThrow('app_user_id must be a string.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        is_computed_offline: 'false',
      }),
    ).toThrow('is_computed_offline must be a boolean.');
    expect(() =>
      testPackage({
        localized_price_string: 99,
      }),
    ).toThrow('localized_price_string must be a string.');
    expect(() =>
      testPackage({
        store: 1,
      }),
    ).toThrow('store must be a string.');
    expect(() =>
      AppActorPurchaseResult.fromJson({
        status: 1,
      }),
    ).toThrow('status must be a string.');
    expect(() =>
      AppActorRemoteConfigItem.fromJson({
        key: 42,
      }),
    ).toThrow('key must be a string.');
    expect(() =>
      AppActorRemoteConfigItem.fromJson({
        key: 'headline',
        value_type: 42,
      }),
    ).toThrow('value_type must be a string.');
    expect(() =>
      AppActorStorefront.fromJson({
        country_code: 90,
      }),
    ).toThrow('country_code must be a string.');

    mockExecute.mockResolvedValue(success(42));
    await expect(AppActor.instance.sdkVersion()).rejects.toThrow('value must be a string.');

    mocks.platform = 'android';
    mockExecute.mockResolvedValue(success({ value: ['in_app_products', 42] }));
    await expect(AppActor.instance.getStoreCapabilities()).rejects.toThrow('value[1] must be a string.');
  });

  it('throws for malformed nested model payloads like Flutter casts', () => {
    expect(() =>
      AppActorRemoteConfigs.fromJson({
        items: ['not_an_object'],
      }),
    ).toThrow('items[] must be an object.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        entitlements: {
          premium: 'not_an_object',
        },
      }),
    ).toThrow('premium must be an object.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        non_subscriptions: {
          coins: ['not_an_object'],
        },
      }),
    ).toThrow('coins[0] must be an object.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        product_entitlements: {
          premium: 'not_a_list',
        },
      }),
    ).toThrow('premium must be an array.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        consumable_balances: {
          coins: 'not_a_number',
        },
      }),
    ).toThrow('consumable_balances.coins must be a number.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        consumable_balances: 'not_a_map',
      }),
    ).toThrow('consumable_balances must be an object.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        product_entitlements: 'not_a_map',
      }),
    ).toThrow('value must be an object.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        product_entitlements: {
          premium: ['com.app.monthly', 42],
        },
      }),
    ).toThrow('premium[1] must be a string.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        active_entitlement_keys: 'premium',
      }),
    ).toThrow('active_entitlement_keys must be an array.');
    expect(() =>
      AppActorCustomerInfo.fromJson({
        active_entitlement_keys: ['premium', 42],
      }),
    ).toThrow('active_entitlement_keys[1] must be a string.');
    expect(() =>
      AppActorTokenBalance.fromJson({
        renewable: 'not_a_number',
      }),
    ).toThrow('renewable must be a number.');
    expect(() =>
      AppActorOfferings.fromJson({
        current: 'not_an_object',
      }),
    ).toThrow('current must be an object.');
    expect(() =>
      AppActorOfferings.fromJson({
        all: {
          main: {
            id: 'main',
            packages: ['not_an_object'],
          },
        },
      }),
    ).toThrow('packages[] must be an object.');
    expect(() =>
      AppActorOfferings.fromJson({
        all: {
          main: {
            id: 'main',
            metadata: {
              rank: 1,
            },
          },
        },
      }),
    ).toThrow('metadata.rank must be a string.');
    expect(() =>
      testPackage({
        metadata: {
          rank: 1,
        },
      }),
    ).toThrow('metadata.rank must be a string.');
    expect(() =>
      testPackage({
        price_amount_micros: 'not_a_number',
      }),
    ).toThrow('price_amount_micros must be a number.');
    expect(() =>
      testPackage({
        price: 'not_a_number',
      }),
    ).toThrow('price must be a number.');
    expect(() =>
      testPackage({
        token_amount: 'not_a_number',
      }),
    ).toThrow('token_amount must be a number.');
    expect(() =>
      testPackage({
        position: 'not_a_number',
      }),
    ).toThrow('position must be a number.');
  });

  it('defaults missing deferred purchase customer info like Flutter', () => {
    const event = AppActorDeferredPurchaseEvent.fromJson({
      product_id: 'com.app.monthly',
    });

    expect(event.productId).toBe('com.app.monthly');
    expect(event.customerInfo).toEqual(expect.any(AppActorCustomerInfo));
    expect(() =>
      AppActorDeferredPurchaseEvent.fromJson({
        product_id: 'com.app.monthly',
        customer_info: 'not_an_object',
      }),
    ).toThrow('customer_info must be an object.');
  });

  it('parses purchase result helper flags directly', () => {
    const purchaseResult = AppActorPurchaseResult.fromJson({
      status: 'restored',
      customer_info: {
        app_user_id: 'user_123',
      },
      purchase_info: {
        store: 'appStore',
        product_id: 'com.app.monthly',
        transaction_id: 'txn_123',
        original_transaction_id: 'orig_123',
        purchase_date: '2026-05-16T12:00:00.000Z',
        is_sandbox: true,
      },
    });

    expect(purchaseResult.status).toBe(AppActorPurchaseStatus.Restored);
    expect(purchaseResult.isRestored).toBe(true);
    expect(purchaseResult.isPurchased).toBe(false);
    expect(purchaseResult.customerInfo?.appUserId).toBe('user_123');
    expect(purchaseResult.purchaseInfo).toEqual(
      expect.objectContaining({
        store: AppActorStore.AppStore,
        productId: 'com.app.monthly',
        transactionId: 'txn_123',
        originalTransactionId: 'orig_123',
        purchaseDate: '2026-05-16T12:00:00.000Z',
        isSandbox: true,
      }),
    );
  });

  it('parses richer experiment assignment payloads directly', () => {
    const experiment = AppActorExperimentAssignment.fromJson({
      experiment_id: 'exp_123',
      experiment_key: 'pricing_test',
      variant_id: 'var_b',
      variant_key: 'B',
      payload: {
        paywall: 'annual_first',
        price_anchor: 59.99,
      },
      value_type: 'json',
      assigned_at: '2026-05-16T12:00:00.000Z',
    });

    expect(experiment).toEqual(
      expect.objectContaining({
        experimentId: 'exp_123',
        experimentKey: 'pricing_test',
        variantId: 'var_b',
        variantKey: 'B',
        payload: {
          paywall: 'annual_first',
          price_anchor: 59.99,
        },
        valueType: AppActorConfigValueType.Json,
        assignedAt: '2026-05-16T12:00:00.000Z',
      }),
    );
  });

  it('supports direct equality checks for purchase result and experiment assignment models', () => {
    const purchaseResultA = AppActorPurchaseResult.fromJson({
      status: 'success',
      customer_info: {
        app_user_id: 'user_123',
      },
      purchase_info: {
        store: 'appStore',
        product_id: 'com.app.monthly',
        transaction_id: 'txn_123',
      },
    });
    const purchaseResultB = AppActorPurchaseResult.fromJson({
      status: 'success',
      customer_info: {
        app_user_id: 'user_123',
      },
      purchase_info: {
        store: 'appStore',
        product_id: 'com.app.monthly',
        transaction_id: 'txn_123',
      },
    });
    const experimentA = AppActorExperimentAssignment.fromJson({
      experiment_id: 'exp_123',
      experiment_key: 'pricing_test',
      variant_id: 'var_b',
      variant_key: 'B',
      payload: {
        paywall: 'annual_first',
      },
      value_type: 'json',
      assigned_at: '2026-05-16T12:00:00.000Z',
    });
    const experimentB = AppActorExperimentAssignment.fromJson({
      experiment_id: 'exp_123',
      experiment_key: 'pricing_test',
      variant_id: 'var_b',
      variant_key: 'B',
      payload: {
        paywall: 'annual_first',
      },
      value_type: 'json',
      assigned_at: '2026-05-16T12:00:00.000Z',
    });

    expect(purchaseResultA).toEqual(purchaseResultB);
    expect(experimentA).toEqual(experimentB);
  });

  it('parses verification fields on customer info and offerings', () => {
    const customerInfo = AppActorCustomerInfo.fromJson({
      app_user_id: 'user_1',
      verification: 'verified',
    });
    const entitlement = AppActorEntitlementInfo.fromJson({
      identifier: 'premium',
      is_active: true,
      active_promotional_offer_type: 'intro7d',
      active_promotional_offer_id: 'offer_123',
    });
    const offerings = AppActorOfferings.fromJson({
      all: {},
      verification: 'verifiedOnDevice',
    });

    expect(customerInfo.verification).toBe(AppActorVerificationResult.Verified);
    expect(entitlement.activePromotionalOfferType).toBe('intro7d');
    expect(entitlement.activePromotionalOfferId).toBe('offer_123');
    expect(offerings.verification).toBe(AppActorVerificationResult.VerifiedOnDevice);
  });

  it('parses promotional offer fields on subscription info', () => {
    const info = AppActorSubscriptionInfo.fromJson({
      subscription_key: 'sub_1',
      product_identifier: 'com.app.monthly',
      is_active: true,
      active_promotional_offer_type: 'winBack',
      active_promotional_offer_id: 'offer_456',
    });

    expect(info.activePromotionalOfferType).toBe('winBack');
    expect(info.activePromotionalOfferId).toBe('offer_456');
  });

  it('accepts Flutter enum-name aliases in decoded payloads', async () => {
    const pkg = testPackage({ package_type: 'twoMonth', product_type: 'nonConsumable', store: 'playStore' });
    const entitlement = AppActorEntitlementInfo.fromJson({
      identifier: 'premium',
      is_active: true,
      ownership_type: 'familyShared',
      period_type: 'twoMonth',
      subscription_status: 'gracePeriod',
      store: 'playStore',
      cancellation_reason: 'customerCancelled',
    });
    const subscription = AppActorSubscriptionInfo.fromJson({
      subscription_key: 'premium_monthly',
      product_identifier: 'com.app.monthly',
      store: 'playStore',
      period_type: 'sixMonth',
      cancellation_reason: 'developerCancelled',
    });

    mocks.platform = 'android';
    mockExecute.mockResolvedValue(success({ value: ['inAppProducts', 'purchaseHistory'] }));
    const capabilities = await AppActor.instance.getStoreCapabilities();

    expect(pkg.packageType).toBe(AppActorPackageType.TwoMonth);
    expect(pkg.productType).toBe(AppActorProductType.NonConsumable);
    expect(pkg.store).toBe(AppActorStore.PlayStore);
    expect(entitlement.ownershipType).toBe('family_shared');
    expect(entitlement.periodType).toBe('two_month');
    expect(entitlement.subscriptionStatus).toBe('grace_period');
    expect(entitlement.store).toBe(AppActorStore.PlayStore);
    expect(entitlement.cancellationReason).toBe('customer_cancelled');
    expect(subscription.store).toBe(AppActorStore.PlayStore);
    expect(subscription.periodType).toBe('six_month');
    expect(subscription.cancellationReason).toBe('developer_cancelled');
    expect(capabilities).toEqual(
      new Set([AppActorStoreCapability.InAppProducts, AppActorStoreCapability.PurchaseHistory]),
    );
  });

  it('exports public wireValue/fromString-style enum helpers', () => {
    expect(appActorStoreWireValue(AppActorStore.PlayStore)).toBe('play_store');
    expect(appActorStoreFromString('playStore')).toBe(AppActorStore.PlayStore);
    expect(appActorPackageTypeWireValue(AppActorPackageType.TwoMonth)).toBe('two_month');
    expect(appActorPackageTypeFromString('twoMonth')).toBe(AppActorPackageType.TwoMonth);
    expect(appActorStoreCapabilityWireValue(AppActorStoreCapability.Storefront)).toBe('storefront');
    expect(appActorStoreCapabilityFromString('purchaseHistory')).toBe(AppActorStoreCapability.PurchaseHistory);
    expect(appActorStoreCapabilityFromString(null)).toBeNull();
    expect(appActorSubscriptionReplacementModeFromString('chargeFullPrice')).toBe(
      AppActorSubscriptionReplacementMode.ChargeFullPrice,
    );
    expect(appActorSubscriptionReplacementModeFromString(null)).toBeNull();
    expect(appActorIntegrationIdentifierFromString('appsFlyerId')).toBe(AppActorIntegrationIdentifier.AppsFlyerId);
    expect(appActorIntegrationIdentifierFromString(null)).toBeNull();
    expect(appActorAttributionProviderWireValue(AppActorAttributionProvider.GoogleAds)).toBe('google_ads');
    expect(appActorAttributionProviderFromString('appleSearchAds')).toBe(AppActorAttributionProvider.AppleSearchAds);
    expect(appActorAttributionProviderFromString(null)).toBeNull();
    expect(appActorAttributionStatusFromString('nonOrganic')).toBe(AppActorAttributionStatus.NonOrganic);
    expect(appActorAttributionStatusFromString('unexpected')).toBeNull();
    expect(appActorAttributionStatusFromString(null)).toBeNull();
    expect(appActorPurchaseStatusFromString('success')).toBe(AppActorPurchaseStatus.Purchased);
    expect(appActorVerificationResultWireValue(AppActorVerificationResult.VerifiedOnDevice)).toBe('verifiedOnDevice');
    expect(appActorVerificationResultIsVerified(AppActorVerificationResult.Verified)).toBe(true);
    expect(appActorVerificationResultIsVerified(AppActorVerificationResult.VerifiedOnDevice)).toBe(true);
    expect(appActorVerificationResultIsVerified(AppActorVerificationResult.Failed)).toBe(false);
    expect(appActorVerificationResultIsVerified(AppActorVerificationResult.NotRequested)).toBe(false);
  });

  it('defaults missing value_type fields to string like Flutter', () => {
    const experiment = AppActorExperimentAssignment.fromJson({
      experiment_id: 'exp_123',
      experiment_key: 'pricing_test',
      variant_id: 'var_b',
      variant_key: 'B',
      payload: 'hero_copy',
    });
    const remoteConfig = AppActorRemoteConfigItem.fromJson({
      key: 'headline',
      value: 'hello',
    });

    expect(experiment.valueType).toBe(AppActorConfigValueType.String);
    expect(remoteConfig.valueType).toBe(AppActorConfigValueType.String);
  });

  it('offers value-style equality helpers for public models', () => {
    const firstCustomer = AppActorCustomerInfo.fromJson({
      app_user_id: 'user_123',
      active_entitlement_keys: ['premium', 'plus'],
      token_balance: {
        renewable: 5,
        non_renewable: 2,
        total: 7,
      },
    });
    const sameCustomer = AppActorCustomerInfo.fromJson({
      app_user_id: 'user_123',
      active_entitlement_keys: ['plus', 'premium'],
      token_balance: {
        renewable: 5,
        non_renewable: 2,
        total: 7,
      },
    });
    const differentCustomer = AppActorCustomerInfo.fromJson({
      app_user_id: 'user_123',
      active_entitlement_keys: ['basic'],
      token_balance: {
        renewable: 5,
        non_renewable: 2,
        total: 7,
      },
    });

    expect(firstCustomer.equals(sameCustomer)).toBe(true);
    expect(appActorModelEquals(firstCustomer, sameCustomer)).toBe(true);
    expect(firstCustomer.equals(differentCustomer)).toBe(false);
    expect(
      new AppActorExperimentAssignment(
        'exp',
        'pricing',
        'variant',
        'A',
        { headline: 'A' },
        AppActorConfigValueType.Json,
        '2026-05-16T12:00:00.000Z',
      ).equals(
        new AppActorExperimentAssignment(
          'exp',
          'pricing',
          'variant',
          'A',
          { headline: 'A' },
          AppActorConfigValueType.Json,
          '2026-05-16T12:00:00.000Z',
        ),
      ),
    ).toBe(true);
    expect(testPackage({ offering_id: 'default' }).equals(testPackage({ offering_id: 'default' }))).toBe(true);
  });

  it('matches Flutter validation for custom integration identifier types', async () => {
    await expect(AppActor.instance.setCustomIntegrationIdentifier('appactor.foo', 'abc')).rejects.toThrow(
      'Integration identifier type cannot start with "appactor.".',
    );

    await expect(AppActor.instance.setCustomIntegrationIdentifier('x'.repeat(65), 'abc')).rejects.toThrow(
      'Integration identifier type can contain at most 64 characters.',
    );
  });

  it('blocks direct AppActor instantiation outside the singleton', () => {
    const AppActorConstructor = AppActor as unknown as new (...args: unknown[]) => AppActor;

    expect(() => new AppActorConstructor()).toThrow('AppActor cannot be instantiated directly. Use AppActor.instance.');
  });
});
