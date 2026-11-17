// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/model';
import { mountModel } from '../src/runtime/mount';

describe('browser runtime', () => {
  it('mounts a model using standard DOM APIs', async () => {
    const model = await buildModel('nodes: [{ id: a }]');
    const container = document.createElement('div');
    const mounted = mountModel(container, model, { theme: 'light', autoplay: false });
    expect(container.querySelector('.fm-wrap svg')).not.toBeNull();
    expect(container.querySelector('.fm-controls button')).not.toBeNull();
    mounted.destroy();
    expect(container.querySelector('.fm-wrap')).toBeNull();
  });
});
