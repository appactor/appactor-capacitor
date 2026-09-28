import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../../package.json';
import type { NativeEvent, NativeListener, NativeRegistration } from './support';
import { deferred, emitNativeEvent as emitSharedNativeEvent, methodsCalled, settle, success } from './support';
import type * as Sdk from '../index';

type ExecuteFn = (method: string, payload: string) => Promise<string | null | undefined>;
type AddListenerFn = (eventName: string, listener: NativeListener) => Promise<unknown>;
type Registration = NativeRegistration & { remove: () => Promise<void> };

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  debug: false,
  execute: vi.fn<ExecuteFn>(),
  addListener: vi.fn<AddListenerFn>(),
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
    addListener: mocks.addListener,
  }),
  WebPlugin: class {},
}));

const registrations: Registration[] = [];

function emitNativeEvent(event: NativeEvent): void {
  emitSharedNativeEvent(registrations, event);
}

function eventsRegistered(): string[] {
  return mocks.addListener.mock.calls.map(([eventName]) => eventName);
}

/** A fresh copy of the SDK per test, so the one-time native listener registration can be observed. */
async function loadSdk(): Promise<typeof Sdk> {
  vi.resetModules();
  return import('../index');
}

describe('AppActor Capacitor bridge', () => {
  beforeEach(() => {
    mocks.platform = 'ios';
    mocks.debug = false;
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue(success(null));
    mocks.addListener.mockReset();
    mocks.addListener.mockImplementation(async (eventName, listener) => {
      const registration: Registration = {
        eventName,
        listener,
        remove: vi.fn(async () => {
          registration.removed = true;
        }),
      };
      registrations.push(registration);
      return registration;
    });
    registrations.splice(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the version constant equal to package.json', async () => {
    const { appActorCapacitorVersion } = await loadSdk();

    expect(appActorCapacitorVersion).toBe(packageJson.version);
  });

  it("registers a stream's native event when it gets its first listener, ahead of a later configure", async () => {
    const order: string[] = [];
    mocks.addListener.mockImplementation(async (eventName) => {
      order.push(`addListener:${eventName}`);
      return { remove: async () => undefined };
    });
    mocks.execute.mockImplementation(async (method) => {
      order.push(method);
      return success(null);
    });
    const { AppActor } = await loadSdk();

    const subscription = AppActor.instance.onCustomerInfoUpdated.listen(vi.fn());
    await AppActor.instance.configure('pk_test_123');

    // This configure sent no customer info, so the wrapper then reads what native has.
    expect(order).toEqual(['addListener:customer_info_updated', 'configure', 'get_cached_customer_info']);
    subscription.remove();
  });

  it('registers each event with native once, and keeps it for the page', async () => {
    const { AppActor } = await loadSdk();
    const listener = vi.fn();

    const customer = AppActor.instance.onCustomerInfoUpdated.listen(listener);
    const receipts = AppActor.instance.onReceiptPipelineEvent.listen(vi.fn());
    await AppActor.instance.configure('pk_test_123');
    await AppActor.instance.configure('pk_test_123');
    customer.remove();
    receipts.remove();
    AppActor.instance.onCustomerInfoUpdated.listen(listener);
    await settle();

    expect(eventsRegistered()).toEqual(['customer_info_updated', 'receipt_pipeline_event']);
    expect(registrations[0].remove).not.toHaveBeenCalled();
    emitNativeEvent({ name: 'customer_info_updated', json: JSON.stringify({ app_user_id: 'user_1' }) });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a removed listener', async () => {
    const { AppActor } = await loadSdk();
    const listener = vi.fn();

    const subscription = AppActor.instance.onCustomerInfoUpdated.listen(listener);
    subscription.remove();
    emitNativeEvent({ name: 'customer_info_updated', json: JSON.stringify({ app_user_id: 'user_1' }) });

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps delivering to other listeners when one throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { AppActor } = await loadSdk();
    const healthy = vi.fn();

    const failing = AppActor.instance.onCustomerInfoUpdated.listen(() => {
      throw new Error('listener bug');
    });
    const working = AppActor.instance.onCustomerInfoUpdated.listen(healthy);
    emitNativeEvent({ name: 'customer_info_updated', json: JSON.stringify({ app_user_id: 'user_1' }) });

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('[AppActor] An event listener threw:', expect.any(Error));
    failing.remove();
    working.remove();
  });

  it('mirrors sdk_log events to the console only in debug builds, and stops after reset', async () => {
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const { AppActor } = await loadSdk();
    const sdkLog = { name: 'sdk_log', json: JSON.stringify({ level: 'info', category: 'net', message: 'hello' }) };

    await AppActor.instance.configure('pk_test_123');
    emitNativeEvent(sdkLog);
    expect(consoleDebug).not.toHaveBeenCalled();

    mocks.debug = true;
    await AppActor.instance.configure('pk_test_123');
    emitNativeEvent(sdkLog);
    expect(consoleDebug).toHaveBeenCalledWith('[AppActor/INFO] net: hello');

    consoleDebug.mockClear();
    await AppActor.instance.reset();
    emitNativeEvent(sdkLog);
    expect(consoleDebug).not.toHaveBeenCalled();
  });

  it('maps a web rejection to AppActorError.codeNativeBridge', async () => {
    const { AppActor, AppActorError } = await loadSdk();
    mocks.execute.mockRejectedValue(
      Object.assign(new Error('AppActor is only available on iOS and Android.'), { code: 'UNAVAILABLE' }),
    );

    const error = await AppActor.instance.getCustomerInfo().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AppActorError);
    expect(error).toMatchObject({
      code: AppActorError.codeNativeBridge,
      message: 'AppActor is only available on iOS and Android.',
      detail: 'UNAVAILABLE',
      isPluginError: true,
    });
  });

  it('explains a missing native plugin', async () => {
    const { AppActor, AppActorError } = await loadSdk();
    mocks.platform = 'android';
    mocks.execute.mockRejectedValue(
      Object.assign(new Error('"AppActor" plugin is not implemented on android'), { code: 'UNIMPLEMENTED' }),
    );

    await expect(AppActor.instance.getOfferings()).rejects.toMatchObject({
      code: AppActorError.codeNativeBridge,
      message: 'The AppActor native plugin is missing on android. Run `npx cap sync` and rebuild the app.',
      detail: '"AppActor" plugin is not implemented on android',
    });
  });

  it('rejects null and malformed native responses', async () => {
    const { AppActor } = await loadSdk();

    mocks.execute.mockResolvedValueOnce(null);
    await expect(AppActor.instance.getCustomerInfo()).rejects.toMatchObject({
      code: 1001,
      message: 'Null response from native',
    });

    mocks.execute.mockResolvedValueOnce('{');
    await expect(AppActor.instance.getCustomerInfo()).rejects.toMatchObject({
      code: 1002,
      message: 'Invalid JSON from native',
    });

    mocks.execute.mockResolvedValueOnce('[]');
    await expect(AppActor.instance.getCustomerInfo()).rejects.toMatchObject({
      code: 1002,
      message: 'Invalid JSON envelope from native',
    });
  });

  it('answers the store helpers locally on the web', async () => {
    const { AppActor } = await loadSdk();
    mocks.platform = 'web';

    await expect(AppActor.instance.canMakePurchases()).resolves.toBe(false);
    await expect(AppActor.instance.getStorefront()).resolves.toBeNull();
    await expect(AppActor.instance.getStoreCapabilities()).resolves.toEqual(new Set());
    await expect(AppActor.instance.enableInstallReferrer()).resolves.toBeUndefined();

    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('answers canMakePurchases natively on Android and locally on iOS', async () => {
    const { AppActor } = await loadSdk();

    mocks.platform = 'ios';
    await expect(AppActor.instance.canMakePurchases()).resolves.toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();

    mocks.platform = 'android';
    mocks.execute.mockResolvedValueOnce(success(false));
    await expect(AppActor.instance.canMakePurchases()).resolves.toBe(false);
    expect(mocks.execute).toHaveBeenCalledWith('can_make_purchases', '{}');
  });

  it('rejects iOS-only helpers and platform keys on the web', async () => {
    const { AppActor, AppActorPlatformKeys, UnsupportedError } = await loadSdk();
    mocks.platform = 'web';

    await expect(AppActor.instance.getAsaDiagnostics()).rejects.toBeInstanceOf(UnsupportedError);
    await expect(AppActor.instance.presentOfferCodeRedeemSheet()).rejects.toThrow(
      'presentOfferCodeRedeemSheet is iOS only',
    );
    await expect(AppActor.instance.configure(new AppActorPlatformKeys('pk_ios', 'pk_android'))).rejects.toThrow(
      'AppActorPlatformKeys is only supported on iOS and Android.',
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('only enables Apple Search Ads tracking on iOS', async () => {
    const { AppActor } = await loadSdk();
    mocks.platform = 'android';

    AppActor.instance.enableSearchAdsTracking();
    await AppActor.instance.configure('pk_test_123');

    expect(methodsCalled(mocks.execute)).toEqual(['configure']);
  });

  it('sends fallback offerings as base64, including buffers larger than one chunk', async () => {
    const { AppActor } = await loadSdk();
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => (index * 31 + 7) % 256);
    const expected = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

    await AppActor.instance.setFallbackOfferings(bytes);
    await AppActor.instance.setFallbackOfferings(bytes.buffer);

    expect(mocks.execute).toHaveBeenNthCalledWith(1, 'set_fallback_offerings', JSON.stringify({ json_data: expected }));
    expect(mocks.execute).toHaveBeenNthCalledWith(2, 'set_fallback_offerings', JSON.stringify({ json_data: expected }));
  });

  it('measures attribute byte limits in UTF-8', async () => {
    const { AppActor } = await loadSdk();

    // 512 two-byte characters are 1024 bytes: the limit exactly.
    await AppActor.instance.setCustomIntegrationIdentifier('custom_id', 'é'.repeat(512));
    await expect(AppActor.instance.setCustomIntegrationIdentifier('custom_id', 'é'.repeat(513))).rejects.toThrow(
      'Integration identifier value must be at most 1024 bytes.',
    );
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('registers sdk_log only once something wants log lines', async () => {
    const { AppActor } = await loadSdk();
    const listener = vi.fn();

    await AppActor.instance.configure('pk_test_123');
    expect(eventsRegistered()).toEqual([]);

    AppActor.instance.onSdkLog.listen(listener);
    expect(eventsRegistered()).toEqual(['sdk_log']);
    emitNativeEvent({ name: 'sdk_log', json: JSON.stringify({ level: 'info', message: 'hello', category: 'sdk' }) });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello' }));
  });

  it('registers sdk_log for console mirroring in debug builds', async () => {
    mocks.debug = true;
    const { AppActor } = await loadSdk();

    await AppActor.instance.configure('pk_test_123');

    expect(eventsRegistered()).toEqual(['sdk_log']);
  });

  it('registers App Store purchase intents with native and delivers them once the page listens', async () => {
    const { AppActor } = await loadSdk();
    const listener = vi.fn();

    AppActor.instance.onPurchaseIntent.listen(listener);
    emitNativeEvent({
      name: 'purchase_intent_received',
      json: JSON.stringify({ intent_id: 'intent_1', product_id: 'com.app.monthly' }),
    });

    expect(eventsRegistered()).toEqual(['purchase_intent_received']);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'intent_1' }));
  });

  it('accepts Search Ads options as a plain object and falls back to defaults for wrong types', async () => {
    const { AppActor } = await loadSdk();

    AppActor.instance.enableSearchAdsTracking({
      autoTrackPurchases: false,
      trackInSandbox: 'yes' as unknown as boolean,
    });
    await AppActor.instance.configure('pk_test_123');

    expect(mocks.execute).toHaveBeenLastCalledWith(
      'enable_apple_search_ads_tracking',
      JSON.stringify({ auto_track_purchases: false, track_in_sandbox: false, debug_mode: false }),
    );
  });

  it('keeps a __proto__ key from native as data', async () => {
    const { AppActorCustomerInfo } = await loadSdk();

    const info = AppActorCustomerInfo.fromJson(
      JSON.parse('{"entitlements":{"__proto__":{"identifier":"__proto__","is_active":true}}}'),
    );

    expect(Object.keys(info.entitlements)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(info.entitlements)).toBe(Object.prototype);
  });

  it('compares models without depending on key order, even for keys a locale compare ties', async () => {
    const { appActorModelEquals } = await loadSdk();
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';

    expect(appActorModelEquals({ [composed]: 1, [decomposed]: 2 }, { [decomposed]: 2, [composed]: 1 })).toBe(true);
  });

  it('clears reset state up front, so an unawaited reset keeps what the next configure sets', async () => {
    mocks.debug = true;
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const { AppActor } = await loadSdk();
    const reset = deferred<string>();
    mocks.execute.mockImplementation((method) => (method === 'reset' ? reset.promise : Promise.resolve(success(null))));

    const resetting = AppActor.instance.reset();
    AppActor.instance.enableSearchAdsTracking();
    const configured = AppActor.instance.configure('pk_test_123');
    reset.resolve(success(null));
    await Promise.all([resetting, configured]);
    emitNativeEvent({ name: 'sdk_log', json: JSON.stringify({ level: 'info', category: 'sdk', message: 'hi' }) });

    expect(methodsCalled(mocks.execute)).toEqual(['reset', 'configure', 'enable_apple_search_ads_tracking']);
    expect(consoleDebug).toHaveBeenCalledWith('[AppActor/INFO] sdk: hi');
  });

  it('sends Search Ads options once, even when configure runs twice at the same time', async () => {
    const { AppActor } = await loadSdk();

    AppActor.instance.enableSearchAdsTracking();
    await Promise.all([AppActor.instance.configure('pk_test_123'), AppActor.instance.configure('pk_test_123')]);

    expect(methodsCalled(mocks.execute)).toEqual(['configure', 'configure', 'enable_apple_search_ads_tracking']);
  });

  it('keeps Search Ads options for the next configure when this one fails', async () => {
    const { AppActor } = await loadSdk();
    mocks.execute.mockResolvedValueOnce(JSON.stringify({ error: { code: 2005, message: 'Network error' } }));

    AppActor.instance.enableSearchAdsTracking();
    await expect(AppActor.instance.configure('pk_test_123')).rejects.toMatchObject({ code: 2005 });
    await AppActor.instance.configure('pk_test_123');

    expect(methodsCalled(mocks.execute)).toEqual(['configure', 'configure', 'enable_apple_search_ads_tracking']);
  });

  it('clears nullable values with null when given undefined', async () => {
    const { AppActor } = await loadSdk();
    const cleared = undefined as unknown as null;

    await AppActor.instance.setEmail(cleared);
    await AppActor.instance.setDisplayName(cleared);
    await AppActor.instance.setPhoneNumber(cleared);
    await AppActor.instance.setPushToken(cleared);
    await AppActor.instance.setCampaign(cleared);

    expect(mocks.execute.mock.calls).toEqual([
      ['set_email', JSON.stringify({ email: null })],
      ['set_display_name', JSON.stringify({ display_name: null })],
      ['set_phone_number', JSON.stringify({ phone_number: null })],
      ['set_push_token', JSON.stringify({ push_token: null })],
      ['set_campaign', JSON.stringify({ value: null })],
    ]);
  });

  it('accepts platform keys and configure options as plain objects', async () => {
    const { AppActor, AppActorLogLevel } = await loadSdk();
    mocks.platform = 'android';

    await AppActor.instance.configure(
      { ios: 'pk_ios', android: 'pk_android' },
      { options: { logLevel: AppActorLogLevel.Debug } },
    );

    expect(JSON.parse(mocks.execute.mock.calls[0][1])).toMatchObject({
      api_key: 'pk_android',
      options: { log_level: 'debug' },
    });
  });

  it("doesn't read Object.prototype members as data", async () => {
    const { AppActorExperiment, AppActorOfferings, AppActorStore, appActorStoreFromString } = await loadSdk();

    expect(appActorStoreFromString('constructor')).toBe(AppActorStore.Unknown);
    expect(AppActorOfferings.fromJson({ all: {} }).offering('toString')).toBeUndefined();
    expect(new AppActorExperiment('exp', null).get('constructor')).toBeUndefined();
  });

  it('keeps attribution metadata from a one-shot iterator for a retry', async () => {
    const { AppActorAttribution, AppActorAttributionProvider } = await loadSdk();
    const metadata = new Map<string, unknown>([['rank', 2]]).entries();

    const attribution = new AppActorAttribution({ provider: AppActorAttributionProvider.AppsFlyer, metadata });

    expect(attribution.toJson()).toEqual({ provider: 'appsflyer', metadata: { rank: 2 } });
    expect(attribution.toJson()).toEqual({ provider: 'appsflyer', metadata: { rank: 2 } });
  });

  it('keeps numeric attribution IDs as strings and drops fields of other types, as RN does', async () => {
    const { AppActorAttribution, AppActorAttributionProvider } = await loadSdk();

    const attribution = new AppActorAttribution({
      provider: AppActorAttributionProvider.Meta,
      campaign: 'spring',
      campaignId: 12345 as unknown as string,
      adId: { id: 1 } as unknown as string,
      attributedAt: new Date('not a date'),
    });

    expect(attribution.toJson()).toEqual({ provider: 'meta', campaign_id: '12345', campaign: 'spring' });
  });

  it('rejects attribute strings over 1024 bytes before native, as native would', async () => {
    const { AppActor } = await loadSdk();

    await AppActor.instance.setAttribute('bio', 'é'.repeat(512));
    await expect(AppActor.instance.setAttribute('bio', 'é'.repeat(513))).rejects.toThrow(
      'value strings must be at most 1024 bytes.',
    );
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects sparse attribute lists before native', async () => {
    const { AppActor } = await loadSdk();
    // eslint-disable-next-line no-sparse-arrays
    const sparse = ['a', , 'b'];

    await expect(AppActor.instance.setAttribute('tags', sparse)).rejects.toThrow(
      'value lists must contain only strings, finite numbers, or booleans.',
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('counts UTF-8 bytes the way TextEncoder does', async () => {
    const { byteLength } = await import('../internal/json');
    const samples = ['', 'ascii', 'é', '€', '😀', 'a😀b', '\ud83d', '\ude00x', 'x\ud83d', 'ç'.repeat(40)];

    for (const sample of samples) {
      expect(byteLength(sample)).toBe(new TextEncoder().encode(sample).length);
    }
  });

  it('pins the same native AppActor versions everywhere', () => {
    const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const iosPins = [
      read('Package.swift').match(/appactor-ios\.git", exact: "([^"]+)"/)?.[1],
      read('AppactorCapacitor.podspec').match(/'AppActorPlugin', '([^']+)'/)?.[1],
      read('README.md').match(/`AppActorPlugin` ([\d.]+)/)?.[1],
    ];
    const androidPins = [
      read('android/build.gradle').match(/com\.appactor:appactor-plugin:([\d.]+)/)?.[1],
      read('README.md').match(/`com\.appactor:appactor-plugin` ([\d.]+)/)?.[1],
    ];

    expect(new Set(iosPins).size).toBe(1);
    expect(iosPins[0]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(androidPins).size).toBe(1);
    expect(androidPins[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('holds purchase intents that arrive between listeners for the next one, for five minutes', async () => {
    const { AppActor } = await loadSdk();
    // Native stamps each intent with the time it arrived.
    const intent = (id: string, receivedAt: number) => ({
      name: 'purchase_intent_received',
      json: JSON.stringify({ intent_id: id, product_id: 'com.app.monthly' }),
      receivedAt,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);

    AppActor.instance.onPurchaseIntent.listen(vi.fn()).remove();
    emitNativeEvent(intent('stale', 0));
    now.mockReturnValue(4 * 60 * 1000);
    emitNativeEvent(intent('fresh', 4 * 60 * 1000));
    now.mockReturnValue(6 * 60 * 1000);
    const listener = vi.fn();
    AppActor.instance.onPurchaseIntent.listen(listener);
    await settle();

    expect(listener.mock.calls.map(([received]) => received.intentId)).toEqual(['fresh']);
  });

  it('drops held purchase intents on reset', async () => {
    const { AppActor } = await loadSdk();

    AppActor.instance.onPurchaseIntent.listen(vi.fn()).remove();
    emitNativeEvent({ name: 'purchase_intent_received', json: JSON.stringify({ intent_id: 'intent_a' }) });
    await AppActor.instance.reset();
    const listener = vi.fn();
    AppActor.instance.onPurchaseIntent.listen(listener);
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  it('lets go of sdk_log once nothing wants log lines', async () => {
    const { AppActor } = await loadSdk();

    const subscription = AppActor.instance.onSdkLog.listen(vi.fn());
    subscription.remove();
    await settle();
    AppActor.instance.onSdkLog.listen(vi.fn());

    expect(eventsRegistered()).toEqual(['sdk_log', 'sdk_log']);
    expect(registrations[0].remove).toHaveBeenCalledTimes(1);
  });

  it("doesn't parse events that nothing listens to", async () => {
    const { AppActor } = await loadSdk();
    // The native registration stays for the page after the last listener goes.
    AppActor.instance.onCustomerInfoUpdated.listen(vi.fn()).remove();
    const parse = vi.spyOn(JSON, 'parse');

    emitNativeEvent({ name: 'customer_info_updated', json: JSON.stringify({ app_user_id: 'user_1' }) });

    expect(parse).not.toHaveBeenCalled();
  });

  it('skips and forgets Search Ads options when a reset overtakes configure', async () => {
    const { AppActor } = await loadSdk();
    const configuring = deferred<string>();
    mocks.execute.mockImplementation((method) =>
      method === 'configure' ? configuring.promise : Promise.resolve(success(null)),
    );

    AppActor.instance.enableSearchAdsTracking();
    const configured = AppActor.instance.configure('pk_test_123');
    const resetting = AppActor.instance.reset();
    configuring.resolve(success(null));
    await Promise.all([configured, resetting]);
    await AppActor.instance.configure('pk_test_123');

    expect(methodsCalled(mocks.execute)).toEqual(['configure', 'reset', 'configure']);
  });

  it("drops purchase intents that reach the page during a reset, so the next user can't buy them", async () => {
    const { AppActor } = await loadSdk();
    const reset = deferred<string>();
    mocks.execute.mockImplementation((method) => (method === 'reset' ? reset.promise : Promise.resolve(success(null))));
    const live = vi.fn();
    AppActor.instance.onPurchaseIntent.listen(live);

    const resetting = AppActor.instance.reset();
    emitNativeEvent({ name: 'purchase_intent_received', json: JSON.stringify({ intent_id: 'user_a_intent' }) });
    reset.resolve(success(null));
    await resetting;
    emitNativeEvent({ name: 'purchase_intent_received', json: JSON.stringify({ intent_id: 'user_b_intent' }) });

    expect(live.mock.calls.map(([intent]) => intent.intentId)).toEqual(['user_b_intent']);
  });

  it('drops purchase intents older than the native store keeps them, by the time native stamped', async () => {
    const { AppActor } = await loadSdk();
    vi.spyOn(Date, 'now').mockReturnValue(10 * 60 * 1000);
    const listener = vi.fn();
    AppActor.instance.onPurchaseIntent.listen(listener);

    emitNativeEvent({ name: 'purchase_intent_received', json: '{"intent_id":"old"}', receivedAt: 4 * 60 * 1000 });
    emitNativeEvent({ name: 'purchase_intent_received', json: '{"intent_id":"new"}', receivedAt: 9 * 60 * 1000 });

    expect(listener.mock.calls.map(([intent]) => intent.intentId)).toEqual(['new']);
  });

  it('keeps a held purchase intent on its original clock when a listener comes and goes', async () => {
    const { AppActor } = await loadSdk();
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    AppActor.instance.onPurchaseIntent.listen(vi.fn()).remove();
    emitNativeEvent({ name: 'purchase_intent_received', json: '{"intent_id":"held"}', receivedAt: 0 });

    now.mockReturnValue(4 * 60 * 1000);
    AppActor.instance.onPurchaseIntent.listen(vi.fn()).remove();
    await settle();
    now.mockReturnValue(6 * 60 * 1000);
    const listener = vi.fn();
    AppActor.instance.onPurchaseIntent.listen(listener);
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  describe('first customer info', () => {
    const current = { app_user_id: 'user_1', active_entitlement_keys: ['pro'] };

    function customerInfoEvent(json: Record<string, unknown>): NativeEvent {
      return { name: 'customer_info_updated', json: JSON.stringify(json) };
    }

    /** Native as a page loaded into a live process sees it: configure is ignored and sends nothing. */
    function nativeAlreadyConfigured(cached: Record<string, unknown> = current): void {
      mocks.execute.mockImplementation(async (method) =>
        success(method === 'get_cached_customer_info' ? cached : null),
      );
    }

    it('replays the info native holds when configure sends none, as after a reload', async () => {
      nativeAlreadyConfigured();
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      await AppActor.instance.configure('pk_test_123');

      expect(methodsCalled(mocks.execute)).toEqual(['configure', 'get_cached_customer_info']);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].appUserId).toBe('user_1');
      expect(listener.mock.calls[0][0].hasActiveEntitlement('pro')).toBe(true);
    });

    it("doesn't read or repeat anything when configure sends the first info, as on a fresh launch", async () => {
      mocks.execute.mockImplementation(async (method) => {
        if (method === 'configure') {
          emitNativeEvent(customerInfoEvent(current));
        }
        return success(null);
      });
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      await AppActor.instance.configure('pk_test_123');

      expect(methodsCalled(mocks.execute)).toEqual(['configure']);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps an event that arrives ahead of the read over the read, which may be older', async () => {
      mocks.execute.mockImplementation(async (method) => {
        if (method !== 'get_cached_customer_info') {
          return success(null);
        }
        emitNativeEvent(customerInfoEvent({ app_user_id: 'user_1', active_entitlement_keys: ['pro', 'plus'] }));
        return success(current);
      });
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      await AppActor.instance.configure('pk_test_123');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].hasActiveEntitlement('plus')).toBe(true);
    });

    it('replays once when two configures run at the same time', async () => {
      nativeAlreadyConfigured();
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      await Promise.all([AppActor.instance.configure('pk_test_123'), AppActor.instance.configure('pk_test_123')]);

      expect(methodsCalled(mocks.execute)).toEqual(['configure', 'configure', 'get_cached_customer_info']);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('leaves the replay to the last overlapping configure, as an ignored one returns early on Android', async () => {
      const startup = deferred<string>();
      let configures = 0;
      mocks.execute.mockImplementation(async (method) => {
        if (method === 'configure' && ++configures === 1) {
          return startup.promise;
        }
        return success(method === 'get_cached_customer_info' ? current : null);
      });
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      const starting = AppActor.instance.configure('pk_test_123');
      await AppActor.instance.configure('pk_test_123');
      expect(listener).not.toHaveBeenCalled();
      emitNativeEvent(customerInfoEvent(current));
      startup.resolve(success(null));
      await starting;

      expect(methodsCalled(mocks.execute)).toEqual(['configure', 'configure']);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("doesn't replay to a page that already has customer info", async () => {
      nativeAlreadyConfigured();
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      await AppActor.instance.configure('pk_test_123');
      await AppActor.instance.configure('pk_test_123');

      expect(methodsCalled(mocks.execute)).toEqual(['configure', 'get_cached_customer_info', 'configure']);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("doesn't replay when native sent customer info before configure", async () => {
      nativeAlreadyConfigured();
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      emitNativeEvent(customerInfoEvent(current));
      await AppActor.instance.configure('pk_test_123');

      expect(methodsCalled(mocks.execute)).toEqual(['configure']);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("doesn't replay native's empty info, which it holds before it has fetched the current user's", async () => {
      nativeAlreadyConfigured({ entitlements: {}, active_entitlement_keys: [] });
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      await AppActor.instance.configure('pk_test_123');

      expect(listener).not.toHaveBeenCalled();
    });

    it("doesn't read when nothing listens for customer info", async () => {
      nativeAlreadyConfigured();
      const { AppActor } = await loadSdk();

      await AppActor.instance.configure('pk_test_123');

      expect(methodsCalled(mocks.execute)).toEqual(['configure']);
    });

    it('leaves configure successful when the read fails', async () => {
      mocks.execute.mockImplementation(async (method) =>
        method === 'get_cached_customer_info'
          ? JSON.stringify({ error: { code: 2001, message: 'Not configured' } })
          : success(null),
      );
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      await expect(AppActor.instance.configure('pk_test_123')).resolves.toBeUndefined();
      expect(listener).not.toHaveBeenCalled();
    });

    it("skips the read when a reset overtakes configure, so configure doesn't wait for it", async () => {
      const reset = deferred<string>();
      mocks.execute.mockImplementation((method) =>
        method === 'reset' ? reset.promise : Promise.resolve(success(current)),
      );
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      const configured = AppActor.instance.configure('pk_test_123');
      const resetting = AppActor.instance.reset();
      await configured;

      expect(methodsCalled(mocks.execute)).toEqual(['configure', 'reset']);
      expect(listener).not.toHaveBeenCalled();
      reset.resolve(success(null));
      await resetting;
    });

    it('drops a read that a reset overtakes, since it holds the signed-out user', async () => {
      const read = deferred<string>();
      mocks.execute.mockImplementation((method) =>
        method === 'get_cached_customer_info' ? read.promise : Promise.resolve(success(null)),
      );
      const { AppActor } = await loadSdk();
      const listener = vi.fn();
      AppActor.instance.onCustomerInfoUpdated.listen(listener);

      const configured = AppActor.instance.configure('pk_test_123');
      await settle();
      expect(methodsCalled(mocks.execute)).toEqual(['configure', 'get_cached_customer_info']);
      const resetting = AppActor.instance.reset();
      read.resolve(success(current));
      await Promise.all([configured, resetting]);

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
