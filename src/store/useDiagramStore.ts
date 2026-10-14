import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createDerivedSlice } from './derivedSlice';
import { createDocumentSlice } from './documentSlice';
import type { Store } from './types';
import { createUiSlice } from './uiSlice';

export const useDiagramStore = create<Store>()(
  immer((...args) => ({
    ...createDocumentSlice(...args),
    ...createDerivedSlice(...args),
    ...createUiSlice(...args),
  })),
);

export type { Store } from './types';
