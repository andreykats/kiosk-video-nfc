import { h, replaceChildren } from './dom';

export interface DialogAction<T> {
  label: string;
  /** null closes the dialog as cancelled. */
  value: T | null;
  kind?: 'primary' | 'danger';
  /** Return false to keep the dialog open (e.g. validation failed). */
  before?: () => boolean | Promise<boolean>;
}

export interface DialogHandle<T> {
  el: HTMLDialogElement;
  body: HTMLElement;
  result: Promise<T | null>;
  close(value: T | null): void;
  setActions(actions: DialogAction<T>[]): void;
}

const openDialogs = new Set<DialogHandle<unknown>>();

/** Cancels every open dialog (e.g. when settings closes on idle). */
export function closeAllDialogs(): void {
  for (const d of [...openDialogs]) d.close(null);
}

/**
 * Modal built on <dialog>. Never uses window.alert/confirm, which block the page
 * (and the kiosk) until dismissed. Esc resolves null.
 */
export function openDialog<T>(options: {
  title: string;
  content: (HTMLElement | string)[];
  actions: DialogAction<T>[];
  testId?: string;
}): DialogHandle<T> {
  const body = h('div', { class: 'dialog-body' }, ...options.content);
  const footer = h('div', { class: 'dialog-actions' });
  const el = h(
    'dialog',
    { class: 'dialog', 'data-testid': options.testId },
    h('h2', {}, options.title),
    body,
    footer,
  );
  let resolve!: (value: T | null) => void;
  const result = new Promise<T | null>((r) => (resolve = r));
  let done = false;

  const close = (value: T | null) => {
    if (done) return;
    done = true;
    openDialogs.delete(handle as DialogHandle<unknown>);
    el.close();
    el.remove();
    resolve(value);
  };

  const setActions = (actions: DialogAction<T>[]) => {
    replaceChildren(
      footer,
      ...actions.map((action) =>
        h(
          'button',
          {
            type: 'button',
            class: action.kind ?? '',
            onclick: async () => {
              if (action.before && !(await action.before())) return;
              close(action.value);
            },
          },
          action.label,
        ),
      ),
    );
  };

  setActions(options.actions);
  el.addEventListener('cancel', (e) => {
    e.preventDefault();
    close(null);
  });
  const handle: DialogHandle<T> = { el, body, result, close, setActions };
  openDialogs.add(handle as DialogHandle<unknown>);
  document.body.append(el);
  el.showModal();
  return handle;
}

export function confirmDialog(options: {
  title: string;
  content: (HTMLElement | string)[];
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  const handle = openDialog<boolean>({
    title: options.title,
    content: options.content,
    actions: [
      { label: 'Cancel', value: false },
      { label: options.confirmLabel, value: true, kind: options.danger ? 'danger' : 'primary' },
    ],
  });
  return handle.result.then((v) => v === true);
}

export function messageDialog(title: string, content: (HTMLElement | string)[]): Promise<void> {
  return openDialog<true>({ title, content, actions: [{ label: 'OK', value: true, kind: 'primary' }] }).result.then(
    () => undefined,
  );
}

export function errorList(errors: string[]): HTMLElement {
  return h('ul', { class: 'error-list' }, ...errors.map((e) => h('li', {}, e)));
}
