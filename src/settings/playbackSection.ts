import { readFillScreen, readInterruptPlayback, writeFillScreen, writeInterruptPlayback } from '../kiosk/playbackOptions';
import { h } from '../ui/dom';
import type { Section } from './section';

export function renderPlaybackSection(): Section {
  const toggle = h('input', { type: 'checkbox', 'data-testid': 'interrupt-playback', checked: readInterruptPlayback() });
  toggle.addEventListener('change', () => writeInterruptPlayback(toggle.checked));
  const fill = h('input', { type: 'checkbox', 'data-testid': 'fill-screen', checked: readFillScreen() });
  fill.addEventListener('change', () => writeFillScreen(fill.checked));
  const el = h(
    'section',
    { 'data-testid': 'playback-section' },
    h('h2', {}, 'Playback'),
    h('label', {}, toggle, ' Tag scans interrupt the playing video'),
    h('p', { class: 'hint' }, 'Off: a tag’s video plays to the end, and other scans are ignored until it does.'),
    h('p', { class: 'hint' }, 'On: a scanned tag starts its video right away, even while another plays. Scanning the same tag again starts its video over.'),
    h('p', { class: 'hint' }, 'Admin tags open settings either way.'),
    h('label', {}, fill, ' Videos fill the screen'),
    h('p', { class: 'hint' }, 'On: videos are zoomed to fill the whole screen, and the edges that don’t fit are cut off. A landscape video on a portrait screen fills its height and shows the middle.'),
    h('p', { class: 'hint' }, 'Off: the whole video is shown, with black bars where its shape doesn’t match the screen.'),
  );
  return { el, destroy: () => undefined };
}
