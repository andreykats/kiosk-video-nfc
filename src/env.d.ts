declare const __APP_VERSION__: string;

// Chrome implements FileSystemHandle.move() for the origin private file system,
// but it is not in the WHATWG spec yet, so lib.dom doesn't declare it.
interface FileSystemFileHandle {
  move?(newName: string): Promise<void>;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
  appinstalled: Event;
}
