import { WebPlugin } from '@capacitor/core';

import type { AppActorNativePlugin } from './definitions';

/** AppActor needs the App Store or Google Play, so every call on the web rejects. */
export class AppActorWeb extends WebPlugin implements AppActorNativePlugin {
  async execute(): Promise<{ response?: string | null }> {
    throw this.unavailable('AppActor is only available on iOS and Android.');
  }
}
