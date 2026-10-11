import { h } from './dom';

/** Hidden file input; call `.click()` on it from a visible button. */
export function filePicker(options: {
  folder: boolean;
  testId: string;
  accept?: string;
  multiple?: boolean;
  onPick: (files: File[]) => void;
}): HTMLInputElement {
  const input = h('input', {
    type: 'file',
    hidden: true,
    multiple: options.multiple ?? true,
    accept: options.folder ? null : (options.accept ?? 'video/*'),
    'data-testid': options.testId,
  });
  if (options.folder) input.webkitdirectory = true;
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) options.onPick(files);
  });
  return input;
}
