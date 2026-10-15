import { readInterruptPlayback, writeInterruptPlayback } from '../kiosk/playbackOptions';
import { h } from '../ui/dom';
import type { Section } from './section';

export function renderPlaybackSection(): Section {
  const toggle = h('input', { type: 'checkbox', 'data-testid': 'interrupt-playback', checked: readInterruptPlayback() });
  toggle.addEventListener('change', () => writeInterruptPlayback(toggle.checked));
  const el = h(
    'section',
    { 'data-testid': 'playback-section' },
    h('h2', {}, 'Playback'),
    h('label', {}, toggle, ' Tag scans interrupt the playing video'),
    h(
      'p',
      { class: 'hint' },
      'Off: a tag’s video plays to the end, and other scans are ignored until it does. On: a scanned tag starts its video right away, even while another plays. Scanning the same tag again starts its video over. Admin tags open settings either way.',
    ),
  );
  return { el, destroy: () => undefined };
}
