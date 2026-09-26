import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

import type { AppActorNativePlugin, NativeEventEnvelope } from './definitions';
import { AppActorError } from './errors';
import type { JsonObject } from './internal/json';
import { asString, ensureRecord, isRecord } from './internal/json';

const PLUGIN_ERROR_NULL_RESPONSE = 1001;
const PLUGIN_ERROR_INVALID_JSON = 1002;

// Not exported from the package: `removeAllListeners()` on it would cut every event stream.
const nativePlugin = registerPlugin<AppActorNativePlugin>('AppActor', {
  web: () => import('./web').then((module) => new module.AppActorWeb()),
});

/** `'ios'`, `'android'` or `'web'`. */
export function currentPlatform(): string {
  return Capacitor.getPlatform();
}

/** Capacitor's debug-build flag: the counterpart of React Native's `__DEV__`. */
export function isDevelopmentRuntime(): boolean {
  return Capacitor.DEBUG === true;
}

function parseNativeEnvelope(payload: string | null | undefined): JsonObject {
  if (payload == null) {
    throw new AppActorError({
      code: PLUGIN_ERROR_NULL_RESPONSE,
      message: 'Null response from native',
    });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch (error) {
    throw new AppActorError({
      code: PLUGIN_ERROR_INVALID_JSON,
      message: 'Invalid JSON from native',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (!isRecord(decoded)) {
    throw new AppActorError({
      code: PLUGIN_ERROR_INVALID_JSON,
      message: 'Invalid JSON envelope from native',
    });
  }

  if (isRecord(decoded.error)) {
    throw AppActorError.fromJson(decoded.error);
  }

  const success = decoded.success;
  if (isRecord(success)) {
    return success;
  }

  return { value: success };
}

function normalizeBridgeFailure(error: unknown): AppActorError {
  const raw = ensureRecord(error);
  const capacitorCode = asString(raw.code);
  const message = asString(raw.message) ?? 'Native bridge call failed';

  if (capacitorCode === 'UNIMPLEMENTED') {
    return new AppActorError({
      code: AppActorError.codeNativeBridge,
      message: `The AppActor native plugin is missing on ${currentPlatform()}. Run \`npx cap sync\` and rebuild the app.`,
      detail: message,
    });
  }

  return new AppActorError({
    code: AppActorError.codeNativeBridge,
    message,
    detail: capacitorCode,
  });
}

/** Runs one native plugin method and unwraps its `{"success": …}` / `{"error": …}` envelope. */
export async function execute(method: string, params?: JsonObject): Promise<JsonObject> {
  const payload = params ? JSON.stringify(params) : '{}';

  let response: string | null | undefined;
  try {
    response = (await nativePlugin.execute({ method, payload }))?.response;
  } catch (error) {
    throw normalizeBridgeFailure(error);
  }

  return parseNativeEnvelope(response);
}

export function addNativeListener(
  eventName: string,
  listener: (event: NativeEventEnvelope) => void,
): Promise<PluginListenerHandle> {
  return nativePlugin.addListener(eventName, listener);
}
