import { describe, expect, it } from 'vitest';

import { AppActorWeb } from '../web';

describe('AppActorWeb', () => {
  it('rejects every call as unavailable', async () => {
    await expect(new AppActorWeb().execute()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'AppActor is only available on iOS and Android.',
    });
  });
});
