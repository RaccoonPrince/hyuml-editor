import type { SliceCreator, UiSlice } from './types';

let toastSeq = 0;

export const createUiSlice: SliceCreator<UiSlice> = (set) => ({
  isDarkMode: false,
  editorWidth: 400,
  isEditorVisible: true,
  selection: [],
  toast: null,

  toggleDarkMode: () => set((s) => { s.isDarkMode = !s.isDarkMode; }),
  setEditorWidth: (width) => set((s) => {
    if (Number.isFinite(width)) s.editorWidth = Math.min(900, Math.max(240, width));
  }),
  toggleEditor: () => set((s) => { s.isEditorVisible = !s.isEditorVisible; }),
  setSelection: (ids) => set((s) => { s.selection = ids; }),
  notify: (message, kind = 'info') => set((s) => { s.toast = { id: (toastSeq += 1), message, kind }; }),
  dismissToast: () => set((s) => { s.toast = null; }),
});
