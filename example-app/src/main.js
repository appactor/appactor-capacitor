import { Capacitor } from '@capacitor/core';
import { AppActor, AppActorError, AppActorLogLevel, AppActorOptions } from 'appactor-capacitor';

const appActor = AppActor.instance;
const output = document.querySelector('#output');
let offerings = null;

function describe(value) {
  if (value instanceof AppActorError) {
    return { code: value.code, message: value.message, detail: value.detail };
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  return value;
}

function log(label, value) {
  const text = JSON.stringify(describe(value), (_key, item) => (item instanceof Set ? [...item] : item), 2);
  console.log(`[AppActorExample] ${label}: ${text}`);
  output.textContent = `${label}: ${text}\n\n${output.textContent}`;
}

async function run(label, action) {
  try {
    log(label, await action());
  } catch (error) {
    log(`${label} failed`, error);
  }
}

function onClick(id, label, action) {
  document.querySelector(id).addEventListener('click', () => run(label, action));
}

appActor.onCustomerInfoUpdated.listen((info) => log('customer_info_updated', info.activeEntitlementKeys));
// iOS: a purchase the user started in the App Store waits for the app to buy it.
appActor.onPurchaseIntent.listen((intent) => run('purchaseFromIntent', () => appActor.purchaseFromIntent(intent)));
appActor.onDeferredPurchaseResolved.listen((event) => log('deferred_purchase_resolved', event.productId));

onClick('#configure', 'configure', async () => {
  const apiKey = document.querySelector('#api-key').value.trim();
  await appActor.configure(apiKey, { options: new AppActorOptions(AppActorLogLevel.Debug) });
  return 'configured';
});

onClick('#offerings', 'getOfferings', async () => {
  offerings = await appActor.getOfferings();
  return offerings.allOfferings.map((offering) => ({
    offeringKey: offering.offeringKey,
    isCurrent: offering.isCurrent,
    packages: offering.packages.map((pkg) => `${pkg.id} ${pkg.localizedPriceString ?? ''}`.trim()),
  }));
});

onClick('#purchase', 'purchasePackage', async () => {
  const pkg = (offerings ?? (await appActor.getOfferings())).current?.packages[0];
  if (!pkg) {
    return 'The current offering has no packages.';
  }
  const result = await appActor.purchasePackage(pkg, { placement: 'example_app' });
  return { status: result.status, activeEntitlements: result.customerInfo?.activeEntitlementKeys };
});

onClick('#restore', 'restorePurchases', async () => {
  const info = await appActor.restorePurchases();
  return info.activeEntitlementKeys;
});

onClick('#customer', 'getCustomerInfo', async () => {
  const info = await appActor.getCustomerInfo();
  return { appUserId: info.appUserId, activeEntitlements: info.activeEntitlementKeys };
});

// Round trips that work before `configure`.
run('platform', async () => Capacitor.getPlatform());
run('sdkVersion', () => appActor.sdkVersion());
run('getAppUserId before configure', () => appActor.getAppUserId());
