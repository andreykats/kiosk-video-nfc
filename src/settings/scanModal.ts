import type { AppContext } from '../app/context';
import type { ScanEvent } from '../scan/scanEvent';
import { h } from '../ui/dom';
import { openDialog, type DialogHandle } from '../ui/dialog';

/**
 * Opens a "Scan card now…" dialog. Settings only consumes scans while one of
 * these is open. `onScan` decides what to do with each card; return true to stop
 * listening (the flow moves on), false to keep waiting for another card.
 */
export function openScanDialog<T>(
  ctx: AppContext,
  options: { title: string; testId: string; onScan: (scan: ScanEvent, dialog: DialogHandle<T>) => boolean },
): DialogHandle<T> {
  const status = h('p', { class: 'scan-status', 'data-testid': 'scan-status' }, 'Scan tag now…');
  const dialog = openDialog<T>({
    title: options.title,
    testId: options.testId,
    content: [status],
    actions: [{ label: 'Cancel', value: null }],
  });
  const unsubscribe = ctx.scanner.scans.subscribe((scan) => {
    if (options.onScan(scan, dialog)) unsubscribe();
  });
  void dialog.result.finally(unsubscribe);
  return dialog;
}

export function scanMessage(dialog: DialogHandle<unknown>, text: string, kind: 'error' | 'info' | 'success' = 'info'): void {
  const status = dialog.body.querySelector<HTMLElement>('[data-testid="scan-status"]');
  if (!status) return;
  status.textContent = text;
  status.className = `scan-status ${kind}`;
}
