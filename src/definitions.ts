import type { PluginListenerHandle } from '@capacitor/core';

/** An SDK event as the native plugin delivers it, under the SDK event's own name. */
export interface NativeEventEnvelope {
  json?: string;
  /** Purchase intents only: when native received it, in milliseconds since the epoch. */
  receivedAt?: number;
}

/**
 * The native side of the plugin. Every SDK call goes through one JSON dispatcher, the same one
 * the Flutter and React Native SDKs use (`AppActorPlugin` on iOS, `appactor-plugin` on Android).
 */
export interface AppActorNativePlugin {
  execute(options: { method: string; payload: string }): Promise<{ response?: string | null }>;
  addListener(eventName: string, listener: (event: NativeEventEnvelope) => void): Promise<PluginListenerHandle>;
}
