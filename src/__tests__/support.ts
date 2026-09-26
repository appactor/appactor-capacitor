// Type imports only: native-order.test.ts needs @capacitor/core to load after its fake native bridge.
import type { NativeEventEnvelope } from '../definitions';

export type NativeListener = (event: NativeEventEnvelope) => void;

/** A native event as a test emits it: `name` picks the listeners, as Capacitor does, and isn't delivered. */
export type NativeEvent = NativeEventEnvelope & { name: string };

export type NativeRegistration = {
  eventName: string;
  listener: NativeListener;
  /** Set by the registration's `remove()`; Capacitor stops delivering to it. */
  removed?: boolean;
};

export function success(value: unknown): string {
  return JSON.stringify({ success: value });
}

/** Delivers an event the way the native plugin does: to the live listeners registered under its name. */
export function emitNativeEvent(registrations: readonly NativeRegistration[], { name, ...event }: NativeEvent): void {
  for (const registration of registrations) {
    if (!registration.removed && registration.eventName === name) {
      registration.listener(event);
    }
  }
}

/** The SDK methods a mocked `execute` received, in order. */
export function methodsCalled(execute: { mock: { calls: ReadonlyArray<readonly [string, ...unknown[]]> } }): string[] {
  return execute.mock.calls.map(([method]) => method);
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
