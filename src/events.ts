import type { PluginListenerHandle } from '@capacitor/core';

import { addNativeListener, isDevelopmentRuntime } from './bridge';
import type { NativeEventEnvelope } from './definitions';
import type { JsonObject } from './internal/json';
import { asString, isRecord } from './internal/json';

/** The SDK event names; native delivers each event under its own name. */
export const SDK_EVENTS = {
  customerInfoUpdated: 'customer_info_updated',
  receiptPipelineEvent: 'receipt_pipeline_event',
  purchaseIntentReceived: 'purchase_intent_received',
  deferredPurchaseResolved: 'deferred_purchase_resolved',
  sdkLog: 'sdk_log',
} as const;

export type AppActorEventSubscription = {
  remove: () => void;
};

type PayloadListener = (payload: JsonObject) => void;

const listenersByEvent = new Map<string, Set<PayloadListener>>();

/*
 * An event is registered with native the first time something listens to it and kept for the life
 * of the page, so none is dropped or doubled by a registration being swapped out. Log lines are
 * best-effort, so theirs comes and goes with its listeners.
 *
 * Known limitation, shared with every Capacitor plugin: Capacitor can drop a page's native
 * listeners while the page stays loaded, when app code calls `removeAllListeners()` on the plugin
 * or an iOS main-frame navigation starts and never commits. Events stop until the page reloads.
 */
const registrations = new Map<string, Promise<PluginListenerHandle | undefined>>();

type Receiver = (eventName: string, event: NativeEventEnvelope) => void;

function register(eventName: string, receive: Receiver): void {
  if (!registrations.has(eventName)) {
    // Without the native plugin the registration fails; every SDK call reports that on its own.
    registrations.set(
      eventName,
      addNativeListener(eventName, (event) => receive(eventName, event)).catch(() => undefined),
    );
  }
}

function unregister(eventName: string): void {
  const registration = registrations.get(eventName);
  registrations.delete(eventName);
  registration?.then((handle) => handle?.remove()).catch(() => undefined);
}

function listenersOf(eventName: string): PayloadListener[] {
  return Array.from(listenersByEvent.get(eventName) ?? []);
}

function decodePayload(json?: string): JsonObject | null {
  if (!json) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dispatch(eventName: string, event: NativeEventEnvelope): void {
  const listeners = listenersOf(eventName);
  const payload = listeners.length > 0 ? decodePayload(event?.json) : null;
  if (!payload) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch (error) {
      console.error('[AppActor] An event listener threw:', error);
    }
  }
}

/*
 * iOS purchase intents. Before the page first listens, native holds them; after that, one that
 * arrives between listeners waits here for the next listener. This hold lives in the page, so a
 * reload loses it: keep one listener for the life of the page. Either way an intent lasts only as
 * long as the iOS SDK's intent store keeps it (five minutes, ten intents), and a reset drops it.
 */
const INTENT_LIFETIME_MS = 5 * 60 * 1000;
const MAX_HELD_INTENTS = 10;
let heldIntents: NativeEventEnvelope[] = [];
let resetsInFlight = 0;

function receiveIntent(eventName: string, event: NativeEventEnvelope): void {
  // During a reset an intent belongs to the user being signed out.
  if (resetsInFlight > 0 || Date.now() - (event.receivedAt ?? Date.now()) > INTENT_LIFETIME_MS) {
    return;
  }
  if (listenersOf(eventName).length === 0) {
    heldIntents = [...heldIntents, event].slice(-MAX_HELD_INTENTS);
    return;
  }
  dispatch(eventName, event);
}

function releaseHeldIntents(): void {
  const held = heldIntents;
  heldIntents = [];
  held.forEach((event) => receiveIntent(SDK_EVENTS.purchaseIntentReceived, event));
}

function subscribe(eventName: string, listener: PayloadListener): AppActorEventSubscription {
  const listeners = listenersByEvent.get(eventName) ?? new Set<PayloadListener>();
  listenersByEvent.set(eventName, listeners);
  listeners.add(listener);

  if (eventName === SDK_EVENTS.purchaseIntentReceived) {
    register(eventName, receiveIntent);
    if (heldIntents.length > 0) {
      // Once the caller holds its subscription, as with an intent that arrives live.
      void Promise.resolve().then(releaseHeldIntents);
    }
  } else {
    register(eventName, dispatch);
  }

  return {
    remove: () => {
      listeners.delete(listener);
      if (eventName === SDK_EVENTS.sdkLog && listeners.size === 0) {
        unregister(eventName);
      }
    },
  };
}

function mirrorSdkLog(payload: JsonObject): void {
  const level = (asString(payload.level) ?? 'info').toUpperCase();
  const category = asString(payload.category) ?? '';
  const message = asString(payload.message) ?? '';
  console.debug(`[AppActor/${level}] ${category}: ${message}`);
}

let sdkLogMirror: AppActorEventSubscription | undefined;

/** Called by `configure()`: debug builds print SDK log lines to the WebView console, as the other AppActor SDKs do. */
export function setSdkLogMirroring(enabled: boolean): void {
  if (enabled) {
    sdkLogMirror ??= subscribe(SDK_EVENTS.sdkLog, mirrorSdkLog);
  } else {
    sdkLogMirror?.remove();
    sdkLogMirror = undefined;
  }
}

/** Called when `reset()` starts: stops the log mirroring and drops the previous user's purchase intents. */
export function beginReset(): void {
  resetsInFlight += 1;
  heldIntents = [];
  setSdkLogMirroring(false);
}

/** Called when `reset()` settles; intents from here on belong to the next user. */
export function endReset(): void {
  resetsInFlight -= 1;
}

/** One kind of SDK event, decoded into its model. Subscribe with `listen`, stop with `remove()`. */
export class AppActorEventStream<T> {
  constructor(
    private readonly eventName: string,
    private readonly decoder: (payload: JsonObject) => T,
  ) {}

  addListener(listener: (value: T) => void): AppActorEventSubscription {
    return subscribe(this.eventName, (payload) => {
      let decoded: T;
      try {
        decoded = this.decoder(payload);
      } catch (error) {
        if (isDevelopmentRuntime()) {
          console.debug(
            `[AppActor] Dropped malformed "${this.eventName}" event: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
        return;
      }
      listener(decoded);
    });
  }

  listen(listener: (value: T) => void): AppActorEventSubscription {
    return this.addListener(listener);
  }
}
