import { autostartUrl, lastAutostartLaunch, onAutostartChange } from '../app/autostart';
import { h } from '../ui/dom';
import { copyableCommand, OPEN_TERMINAL, scriptUrl } from '../ui/terminalCommand';
import { reactiveSection, type Section } from './section';

const MAC_AUTOSTART_SCRIPT = 'mac-kiosk-autostart.sh';
const KIOSK_FLAGS = '--kiosk --autoplay-policy=no-user-gesture-required';

/**
 * How to make this computer open the kiosk fullscreen at startup. Macs run a
 * script (public/mac-kiosk-autostart.sh) that adds a login item and turns on
 * automatic login; it reads its passwords from the terminal, so it can be piped
 * into bash. Windows uses a Startup shortcut. Either way Chrome opens the kiosk
 * with `?autostart`, which turns the checklist's "Opens at startup" green.
 */
export function autostartHelp(): HTMLElement {
  const kioskUrl = autostartUrl(new URL(import.meta.env.BASE_URL, location.href).href);
  const platform = navigator.platform;
  if (platform.startsWith('Mac')) {
    return h(
      'div',
      { class: 'autostart-help', 'data-testid': 'mac-autostart' },
      h(
        'ol',
        { class: 'hint' },
        h('li', {}, 'Press Copy command.'),
        h('li', {}, OPEN_TERMINAL),
        h('li', {}, 'Paste the command (⌘ V) and press Return.'),
        h('li', {}, 'Type this Mac’s password each time it asks, and press Return. Nothing shows while you type.'),
        h('li', {}, 'If macOS asks to let Terminal control System Events, choose OK.'),
      ),
      ...copyableCommand(`curl -fsSL ${scriptUrl(MAC_AUTOSTART_SCRIPT)} | bash`, 'mac-autostart'),
    );
  }
  if (platform.startsWith('Win')) {
    return h(
      'div',
      { class: 'autostart-help', 'data-testid': 'windows-autostart' },
      h(
        'ol',
        { class: 'hint' },
        h('li', {}, 'Press Copy command.'),
        h('li', {}, 'Press Windows + R, type shell:startup, then press Enter. A folder opens.'),
        h('li', {}, 'Right-click in the folder and choose New → Shortcut. Paste the command (Ctrl + V) and press Next.'),
        h('li', {}, 'Name it Topps Kiosk and press Finish.'),
        h('li', {}, 'Make Windows sign in automatically, so the shortcut runs after a restart.'),
      ),
      ...copyableCommand(`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ${KIOSK_FLAGS} ${kioskUrl}`, 'windows-autostart'),
    );
  }
  return h(
    'div',
    { class: 'autostart-help', 'data-testid': 'other-autostart' },
    h('p', { class: 'hint' }, 'Set this computer to sign in automatically and run this command at login:'),
    ...copyableCommand(`google-chrome ${KIOSK_FLAGS} ${kioskUrl}`, 'other-autostart'),
  );
}

/**
 * How to undo the Mac script: the same script with --uninstall, which also opens the kiosk
 * with `?autostart=removed` so this section goes back to the setup steps. The
 * Windows shortcut and the other commands have no script to undo them.
 */
function autostartRemovalHelp(): HTMLElement[] {
  if (!navigator.platform.startsWith('Mac')) return [];
  return [
    h('h3', {}, 'Stop opening at startup'),
    h(
      'div',
      { class: 'autostart-help', 'data-testid': 'mac-autostart-uninstall' },
      h(
        'ol',
        { class: 'hint' },
        h('li', {}, 'Press Copy command.'),
        h('li', {}, OPEN_TERMINAL),
        h('li', {}, 'Paste the command (⌘ V) and press Return.'),
        h('li', {}, 'If it asks for this Mac’s password, type it and press Return. Nothing shows while you type.'),
        h('li', {}, 'Chrome opens a tab saying the kiosk no longer opens at startup. Close that tab.'),
      ),
      ...copyableCommand(`curl -fsSL ${scriptUrl(MAC_AUTOSTART_SCRIPT)} | bash -s -- --uninstall`, 'mac-autostart-uninstall'),
      h('p', { class: 'hint' }, 'It also turns automatic login and Chrome’s login settings back to how they were before the setup.'),
    ),
  ];
}

/**
 * Settings → Open at startup: the setup guide's step 7 instructions until the
 * startup command has opened the kiosk, then that it has and how to undo it.
 * The launch is recorded at load, or forgotten in the tab the uninstall script
 * opens, so this re-renders when another tab changes it.
 */
export function renderAutostartSection(): Section {
  const el = h('section', { 'data-testid': 'autostart-section' });
  const render = () => {
    const launchedAt = lastAutostartLaunch();
    el.replaceChildren(
      h('h2', {}, 'Open at startup'),
      ...(launchedAt
        ? [
            h('p', { class: 'success', 'data-testid': 'autostart-status' }, `This computer opened the kiosk at startup ✓ (last on ${launchedAt.toLocaleString()})`),
            ...autostartRemovalHelp(),
          ]
        : [
            h('p', { class: 'hint' }, 'Set this computer to open the kiosk fullscreen every time it starts, with no one there to click.'),
            autostartHelp(),
            h('p', { class: 'hint' }, 'Then restart the computer. The kiosk should open fullscreen by itself, and this section shows ✓ once it has.'),
          ]),
    );
  };
  return reactiveSection(el, render, [onAutostartChange]);
}
