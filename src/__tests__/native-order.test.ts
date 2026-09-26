import { beforeAll, describe, expect, it } from 'vitest';

import type * as Sdk from '../index';
import { deferred, settle, success } from './support';

type Post = { method: string; options: Record<string, unknown> };

/** What reaches native, in order, as the real @capacitor/core registerPlugin proxy posts it. */
const posts: Post[] = [];
let resetDone: Promise<void> = Promise.resolve();

/**
 * Stands in for the iOS native bridge. It must be in place before @capacitor/core initializes,
 * because core picks up the platform and the plugin's method headers at import time.
 */
function installNativeBridge(): void {
  Object.assign(globalThis, {
    webkit: { messageHandlers: { bridge: {} } },
    Capacitor: {
      PluginHeaders: [
        {
          name: 'AppActor',
          methods: [
            { name: 'addListener' },
            { name: 'removeListener' },
            { name: 'removeAllListeners', rtype: 'promise' },
            { name: 'execute', rtype: 'promise' },
          ],
        },
      ],
      nativePromise: async (_plugin: string, method: string, options: Record<string, unknown>) => {
        posts.push({ method, options });
        if (options.method === 'reset') {
          await resetDone;
        }
        return { response: success(null) };
      },
      nativeCallback: (_plugin: string, method: string, options: Record<string, unknown>) => {
        posts.push({ method, options });
        return String(posts.length);
      },
    },
  });
}

function postedMethods(): string[] {
  return posts.map(({ method, options }) => (method === 'execute' ? String(options.method) : method));
}

describe('native call order through the real Capacitor bridge', () => {
  let sdk: typeof Sdk;

  beforeAll(async () => {
    installNativeBridge();
    sdk = await import('../index');
  });

  it('posts calls made right after an unawaited configure behind it', async () => {
    const configured = sdk.AppActor.instance.configure('pk_test_123');
    const loggedIn = sdk.AppActor.instance.logIn('user_1');
    await Promise.all([configured, loggedIn]);

    expect(postedMethods()).toEqual(['configure', 'log_in']);
  });

  it('holds configure and later calls until a running reset finishes', async () => {
    posts.length = 0;
    const reset = deferred<void>();
    resetDone = reset.promise;

    const resetting = sdk.AppActor.instance.reset();
    const configured = sdk.AppActor.instance.configure('pk_test_123');
    const loggedIn = sdk.AppActor.instance.logIn('user_1');
    await settle();
    expect(postedMethods()).toEqual(['reset']);

    reset.resolve();
    await Promise.all([resetting, configured, loggedIn]);
    expect(postedMethods()).toEqual(['reset', 'configure', 'log_in']);
  });
});
