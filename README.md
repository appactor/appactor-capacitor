# AppActor Capacitor

Server-authoritative in-app purchases for Capacitor apps on iOS and Android: purchases, entitlements, offerings,
remote config, experiments, customer attributes and attribution.

The plugin is a thin bridge. The work is done by the native AppActor SDKs through the same plugin layer the Flutter and
React Native SDKs use, so every AppActor SDK behaves the same way.

|                      | Version                                                      |
| -------------------- | ------------------------------------------------------------ |
| Capacitor            | 8 (tested with 8.5.2)                                        |
| iOS                  | 15+ (StoreKit 2)                                             |
| Android              | minSdk 24 (Google Play Billing)                              |
| iOS native layer     | `AppActorPlugin` 0.1.13 (Swift Package Manager or CocoaPods) |
| Android native layer | `com.appactor:appactor-plugin` 2.3.15 (Maven Central)        |

Capacitor 9 (in alpha) requires iOS 16, one version above this release's iOS minimum; a later release will support it.

## Installation

```sh
npm install appactor-capacitor
npx cap sync
```

Swift Package Manager (the default for new Capacitor 8 apps) and CocoaPods both work; `npx cap sync` wires up
whichever the app uses. With CocoaPods, run `pod install --repo-update` once if the local specs cache doesn't have the
`AppActorPlugin` version above yet.

## Quick start

```ts
import { AppActor, AppActorLogLevel, AppActorOptions } from 'appactor-capacitor';

await AppActor.instance.configure('pk_YOUR_PUBLIC_API_KEY', {
  appUserId: 'user_123', // optional; anonymous when omitted
  options: new AppActorOptions(AppActorLogLevel.Debug),
});

const offerings = await AppActor.instance.getOfferings();
const monthly = offerings.current?.monthly;
if (monthly) {
  const result = await AppActor.instance.purchasePackage(monthly, { placement: 'onboarding_paywall' });
  const customerInfo = result.customerInfo ?? (await AppActor.instance.getCustomerInfo());
  const isPremium = customerInfo.hasActiveEntitlement('premium');
}
```

Use one key per store with `AppActorPlatformKeys`; `configure` picks the one for the running platform:

```ts
import { AppActor, AppActorPlatformKeys } from 'appactor-capacitor';

await AppActor.instance.configure(new AppActorPlatformKeys('pk_ios_…', 'pk_android_…'));
```

### Running in a browser

AppActor needs the App Store or Google Play. On the web (`ionic serve`, `vite dev`):

- calls that need the native SDK reject with an `AppActorError` whose code is `AppActorError.codeNativeBridge` (1099);
- the store helpers answer locally: `canMakePurchases()` is `false`, `getStorefront()` is `null`,
  `getStoreCapabilities()` is empty and `enableInstallReferrer()` does nothing;
- iOS-only APIs and `configure(new AppActorPlatformKeys(…))` throw `UnsupportedError`.

Guard the SDK with `Capacitor.isNativePlatform()` when the same code also runs in a browser:

```ts
import { Capacitor } from '@capacitor/core';

if (Capacitor.isNativePlatform()) {
  await AppActor.instance.configure('pk_YOUR_PUBLIC_API_KEY');
}
```

## Offerings and experiments

```ts
const offerings = await AppActor.instance.getOfferings();
offerings.current; // the current offering
offerings.allOfferings; // AppActorOffering[], current first
offerings.getOffering('onboarding'); // by offering key (the dashboard "lookup key")
const onboarding = await AppActor.instance.getOffering('onboarding'); // fetch + lookup in one call

// Experiments are never null, so there is nothing to null-check.
const paywall = await AppActor.instance.getExperiment('paywall_test');
if (paywall.isVariant('annual_first')) showAnnualFirst();
paywall.variantKey; // 'control', 'annual_first', … or null when not enrolled

const showOnboarding = (await AppActor.instance.getExperiment('has_onboard')).boolValue(true);
const title = (await AppActor.instance.getExperiment('onboarding_flow')).get('title') ?? 'Welcome';
```

## Remote config

```ts
const configs = await AppActor.instance.getRemoteConfigs();
const headline = configs.get('headline')?.stringValue;

await AppActor.instance.getRemoteConfigBool('show_banner'); // boolean | null
await AppActor.instance.getRemoteConfigInt('max_items'); // integral numbers only
```

## Purchases

```ts
await AppActor.instance.purchasePackage(pkg, {
  placement: 'settings_upgrade', // trimmed; dropped when blank or longer than 255 characters
  quantity: 1, // consumables; Google Play takes only 1
  // Android subscription upgrades and downgrades:
  oldPurchaseToken: '…',
  replacementMode: AppActorSubscriptionReplacementMode.ChargeProrated,
});

await AppActor.instance.restorePurchases();
await AppActor.instance.syncPurchases(); // quiet store sync
await AppActor.instance.drainReceiptQueueAndRefreshCustomer(); // explicit receipt-queue drain
```

`quietSyncPurchases()` is a deprecated alias of `syncPurchases()`.

## Customer attributes and attribution

```ts
import { AppActor, AppActorAttributeValue, AppActorIntegrationIdentifier } from 'appactor-capacitor';

await AppActor.instance.setAttributes({
  favorite_category: 'watch_faces',
  last_seen: new Date(),
  flags: AppActorAttributeValue.boolList([true, false]),
});
await AppActor.instance.setEmail('user@example.com');
await AppActor.instance.setIntegrationIdentifier(AppActorIntegrationIdentifier.AppsFlyerId, 'af-user-123');
await AppActor.instance.setCampaign('spring_sale');
await AppActor.instance.setCampaign(null); // clears it
```

Custom keys are at most 64 characters of letters, digits and `_ . : -`, and can't start with `appactor.` or
`integration.`. The profile-context names AppActor fills in itself are reserved: `appVersion`, `appBuild`,
`sdkVersion`, `platform`, `platformFlavor`, `platformVersion`, `osVersion`, `deviceModel`, `bundleId`, `locale`,
`timezone`, `storefrontCountry`, `ipCountry`, `localeCountry`, `attConsentStatus`, `deviceLocale`, `userCountry` and
`userCountrySource`. Values are strings (at most 1024 bytes), finite numbers, booleans, `Date`s or flat lists of one primitive type (arrays
or `Set`s, at most 20 items). Delete with `unsetAttribute(key)`; `null` is rejected. Invalid input throws before
anything reaches native code.

## Events

Subscriptions are synchronous; keep the handle and call `remove()` when you're done. An event reaches the listeners
that exist when it arrives, and `configure()` emits the first `customer_info_updated`, so subscribe before
`configure()` (or read the current state with `getCustomerInfo()`):

```ts
const subscription = AppActor.instance.onCustomerInfoUpdated.listen((info) => {
  console.log('active entitlements', info.activeEntitlementKeys);
});
AppActor.instance.onReceiptPipelineEvent.listen((event) => console.log(event.type, event.productId));
AppActor.instance.onDeferredPurchaseResolved.listen((event) => console.log(event.productId));
AppActor.instance.onPurchaseIntent.listen((intent) => {
  AppActor.instance.purchaseFromIntent(intent).catch((error) => console.warn('purchase failed', error)); // iOS
});
AppActor.instance.onSdkLog.listen((log) => console.log(log.level, log.message));

await AppActor.instance.configure('pk_YOUR_PUBLIC_API_KEY');

subscription.remove();
```

On iOS 16.4+, purchases the user starts in the App Store (promoted in-app purchases, win-back offers) arrive through
`onPurchaseIntent`, and nothing is bought until the app calls `purchaseFromIntent(intent)`. Keep a listener that does,
subscribed before `configure()` and kept for the life of the page. Intents that arrive before the page first listens
are held natively and handed to the first listener; one that arrives between two listeners waits only in the page, so
a reload loses it. `reset()` drops held intents (the in-page ones only in the page that calls it), and every intent is
forgotten five minutes after it arrived.

SDK log lines don't cross the bridge until something wants them: an `onSdkLog` listener, or, in debug builds
(`Capacitor.DEBUG`), `configure()`, after which they are also printed to the WebView console as
`[AppActor/LEVEL] category: message`.

## Errors

Every failure is an `AppActorError` with a numeric `code`, a `message`, and optional `detail`, `requestId`, `scope` and
`retryAfterSeconds`:

- `2001`–`2099`: SDK errors, with named constants (`AppActorError.codeNetwork`, `codePurchaseFailed`, …) and helpers
  (`isNetwork`, `isTransient`, `isNotConfigured`, …).
- `1000`–`1999`: plugin errors (`isPluginError`). `1099` (`AppActorError.codeNativeBridge`) means the call never
  reached the native SDK: the app runs on the web, or the native plugin is missing (run `npx cap sync` and rebuild).

Input that can never be valid (a malformed attribute key, a purchase quantity of 0) throws a plain `Error` before the
call is sent, and iOS-only APIs called elsewhere throw `UnsupportedError`.

## Platform notes

- iOS only: `presentOfferCodeRedeemSheet()`, `purchaseFromIntent()` (iOS 16.4+), `getAsaDiagnostics()`,
  `getPendingAsaPurchaseEventCount()`, `getAsaFirstInstallOnDevice()`, `getAsaFirstInstallOnAccount()`.
- Call `enableSearchAdsTracking()` before `configure()` to turn on Apple Search Ads attribution. It takes an
  `AppActorAsaOptions` or a plain `{ autoTrackPurchases, trackInSandbox, debugMode }` object.
- Android only: `enableInstallReferrer()` (call after `configure()`; a no-op elsewhere), `getStorefront()` (`null`
  elsewhere) and `getStoreCapabilities()` (empty elsewhere). `canMakePurchases()` asks Google Play on Android, is
  `true` on iOS and `false` on the web.
- `getAppUserId()` returns `null` before `configure()`.
- Await `reset()` before reloading or navigating the page, or before configuring from another WebView: the native SDK
  ignores a `configure()` that arrives while it resets, and only the page that called `reset()` knows to wait.
- Android 7.x (API 24–25): the native AppActor SDK uses `java.time`, which those versions lack, so an app whose
  `minSdkVersion` is below 26 must turn on core library desugaring in `android/app/build.gradle`:

  ```groovy
  android {
      compileOptions {
          coreLibraryDesugaringEnabled true
      }
  }
  dependencies {
      coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'
  }
  ```

## API overview

- Lifecycle: `enableSearchAdsTracking()`, `configure()`, `reset()`, `sdkVersion()`, `setLogLevel()`,
  `enableInstallReferrer()`
- Identity: `logIn()`, `logOut()`, `getAppUserId()`, `getIsAnonymous()`
- Commerce: `purchasePackage()`, `restorePurchases()`, `syncPurchases()`, `drainReceiptQueueAndRefreshCustomer()`,
  `setFallbackOfferings()`
- Data and cache: `getCustomerInfo()`, `getOfferings()`, `getOffering()`, `getCachedOfferings()`,
  `getCachedRemoteConfigs()`, `getCachedCustomerInfo()`, `activeEntitlementKeysOffline()`, `canMakePurchases()`,
  `getStorefront()`, `getStoreCapabilities()`
- Customer data: `setAttributes()`, `setAttribute()`, `unsetAttribute()`, `setEmail()`, `setDisplayName()`,
  `setPhoneNumber()`, `setPushToken()`, `collectDeviceIdentifiers()`
- Attribution and integrations: `setIntegrationIdentifier()`, `setCustomIntegrationIdentifier()`,
  `unsetIntegrationIdentifier()`, `unsetCustomIntegrationIdentifier()`, `updateAttribution()`, `setMediaSource()`, `setCampaign()`, `setAdGroup()`, `setAd()`, `setKeyword()`,
  `setCreative()`, plus `setAppsFlyerID()`, `setAdjustID()`, `setBranchID()`, `setFirebaseAppInstanceID()`,
  `setOneSignalID()`
- Remote config and experiments: `getRemoteConfigs()`, `getRemoteConfig()`, `getRemoteConfigBool()`,
  `getRemoteConfigString()`, `getRemoteConfigNumber()`, `getRemoteConfigInt()`, `getExperiment()`,
  `getExperimentAssignment()`
- Events: `onCustomerInfoUpdated`, `onReceiptPipelineEvent`, `onPurchaseIntent`, `onDeferredPurchaseResolved`,
  `onSdkLog`

## Example app

[`example-app/`](example-app) configures the SDK, lists offerings, buys the first package of the current offering,
restores, and prints customer-info events:

```sh
npm install && npm run build
cd example-app
npm install && npm run build
npx cap add ios && npx cap add android
npx cap sync
npx cap open ios # or: npx cap open android
```

## Development

```sh
npm install
npm run verify:web     # typecheck, lint, unit tests, build
npm run verify:ios     # xcodebuild of the Swift package and its tests (IOS_SIMULATOR, default "iPhone 17")
npm run verify:android # Gradle build and unit tests; needs JDK 21 and the Android SDK
```

## License

MIT
