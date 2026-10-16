#!/bin/bash
# Sets up a Mac to open the kiosk in Chrome kiosk mode at every login
# (docs/kiosk-setup.md, "macOS"). Finish the setup guide in Chrome first, then
# run this as the user the kiosk signs in as:
#
#   curl -fsSL https://topps.drey.dev/mac-kiosk-autostart.sh | bash
#
# Pass options after `bash -s --`, e.g. `... | bash -s -- --dry-run`.

set -euo pipefail

LABEL="dev.drey.topps-kiosk"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
# What this script changed, so mac-kiosk-autostart-uninstall.sh can put it back.
STATE="$HOME/Library/Application Support/$LABEL/install-state"
URL="https://topps.drey.dev/"
DRY_RUN=0
KIOSK_USER="$(id -un)"

say()  { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die()  { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: mac-kiosk-autostart.sh [--url <https-url>] [--dry-run]

  --url <url>   Page to open (default https://topps.drey.dev/)
  --dry-run     Show what would change without changing anything

Sets up:
  - a LaunchAgent that opens Chrome in kiosk mode at login
  - Google Chrome removed from Login Items, and "Reopen windows" off,
    so Chrome isn't already running when the kiosk command runs
  - automatic login for this user (asks for passwords; needs FileVault off)

It saves what was set before, so mac-kiosk-autostart-uninstall.sh can undo it.
EOF
}

while (($#)); do
  case "$1" in
    --url) [[ $# -ge 2 ]] || die "--url needs a value"; URL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[[ "$(uname -s)" == Darwin ]] || die "this script is for macOS"
((EUID != 0)) || die "run it as the kiosk's user, without sudo (it asks for an admin password when it needs one)"
[[ "$URL" =~ ^https://[^[:space:]#]+$ ]] || die "--url must be an https:// address without a #, got: $URL"

# The kiosk sees ?autostart and marks "Opens at startup" done in its setup checklist.
if [[ "$URL" == *\?* ]]; then LAUNCH_URL="$URL&autostart"; else LAUNCH_URL="$URL?autostart"; fi

has_tty() { { : </dev/tty; } 2>/dev/null; }

# The state file has one key=value per line. It's read line by line, never sourced.
state_get() {
  local line
  [[ -f "$STATE" ]] || return 1
  while IFS= read -r line; do
    [[ "${line%%=*}" == "$1" ]] && { printf '%s' "${line#*=}"; return 0; }
  done <"$STATE"
  return 1
}

state_set() {
  local tmp
  [[ "$2" != *$'\n'* ]] || die "can't save a value with a line break for $1"
  ((DRY_RUN)) && return
  mkdir -p "$(dirname "$STATE")"
  tmp="$(mktemp -t topps-kiosk)"
  if [[ -f "$STATE" ]]; then grep -v "^$1=" "$STATE" >"$tmp" || true; fi
  printf '%s=%s\n' "$1" "$2" >>"$tmp"
  mv "$tmp" "$STATE"
}

# Keeps the first value: a second run mustn't save this script's own change as the one to restore.
state_set_once() { state_get "$1" >/dev/null || state_set "$1" "$2"; }

write_agent() {
  local tmp arg
  tmp="$(mktemp -t topps-kiosk)"
  # plutil escapes the values, so any URL is safe to put in the plist.
  plutil -create xml1 "$tmp"
  plutil -insert Label -string "$LABEL" "$tmp"
  plutil -insert ProgramArguments -array "$tmp"
  for arg in /usr/bin/open -na "Google Chrome" --args \
             --kiosk --autoplay-policy=no-user-gesture-required "$LAUNCH_URL"; do
    plutil -insert ProgramArguments -string "$arg" -append "$tmp"
  done
  plutil -insert RunAtLoad -bool true "$tmp"
  plutil -lint -s "$tmp" || { rm -f "$tmp"; die "generated LaunchAgent is not a valid plist"; }

  if ((DRY_RUN)); then
    say "Would write $AGENT:"
    cat "$tmp"
    rm -f "$tmp"
    return
  fi
  mkdir -p "$(dirname "$AGENT")"
  chmod 644 "$tmp"
  mv "$tmp" "$AGENT"
  say "✓ Kiosk opens at login: $AGENT"
}

remove_chrome_login_item() {
  if ((DRY_RUN)); then
    say "Would remove Google Chrome from Login Items"
    return
  fi
  local path
  # Needs permission for this terminal to control System Events; macOS asks once.
  # Prints the removed item's path, or nothing if Chrome wasn't a login item.
  if path="$(osascript -e 'tell application "System Events"
      set found to every login item whose name is "Google Chrome"
      if found is {} then return ""
      set p to path of item 1 of found
      delete (every login item whose name is "Google Chrome")
      return p
    end tell' 2>/dev/null)"; then
    [[ -z "$path" ]] || state_set_once chrome_login_item "$path"
    say "✓ Google Chrome is not in Login Items"
  else
    warn "couldn't check Login Items. Remove Google Chrome from System Settings → General → Login Items by hand, if it's there."
  fi
}

disable_reopen_windows() {
  if ((DRY_RUN)); then
    say "Would turn off \"Reopen windows when logging back in\""
    return
  fi
  local before
  case "$(defaults read com.apple.loginwindow TALLogoutSavesState 2>/dev/null || true)" in
    1) before=true ;;
    0) before=false ;;
    *) before=unset ;;
  esac
  state_set_once reopen_windows "$before"
  defaults write com.apple.loginwindow TALLogoutSavesState -bool false
  say "✓ \"Reopen windows when logging back in\" is off"
}

enable_autologin() {
  local current pw
  current="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)"
  if [[ "$current" == "$KIOSK_USER" ]]; then
    say "✓ Automatic login is already on for $KIOSK_USER"
    return
  fi
  if fdesetup isactive >/dev/null 2>&1; then
    warn "FileVault is on, so macOS can't log in automatically and the kiosk won't start after a restart until someone logs in. To fix it, turn off FileVault in System Settings → Privacy & Security, then run this script again."
    return
  fi
  if ((DRY_RUN)); then
    say "Would turn on automatic login for $KIOSK_USER"
    return
  fi
  if ! has_tty; then
    warn "no terminal to ask for a password, so automatic login was not turned on. Turn it on in System Settings → Users & Groups."
    return
  fi

  read -rsp "Password for $KIOSK_USER (for automatic login): " pw </dev/tty
  printf '\n' >/dev/tty
  # Check it first: sysadminctl would otherwise store a wrong password and login would fail.
  if ! dscl /Search -authonly "$KIOSK_USER" "$pw" >/dev/null 2>&1; then
    warn "that password is wrong, so automatic login was not turned on. Run the script again."
    return
  fi
  say "Turning on automatic login (sudo asks for an admin password)…"
  if sudo sysadminctl -autologin set -userName "$KIOSK_USER" -password "$pw" </dev/tty \
     && [[ "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)" == "$KIOSK_USER" ]]; then
    state_set_once autologin "$current"
    say "✓ Automatic login is on for $KIOSK_USER"
  else
    warn "couldn't turn on automatic login. Turn it on in System Settings → Users & Groups (needs an admin)."
  fi
}


[[ -d "/Applications/Google Chrome.app" || -d "$HOME/Applications/Google Chrome.app" ]] \
  || die "Google Chrome isn't installed in /Applications. Install it and finish the kiosk setup guide first."

((DRY_RUN)) && say "Dry run: nothing will be changed."
state_set launch_url "$LAUNCH_URL"
write_agent
remove_chrome_login_item
disable_reopen_windows
enable_autologin

if ((!DRY_RUN)); then
  say ""
  say "Done. Restart the Mac to check: after login, Chrome should open $URL fullscreen."
  say "If macOS shows \"Background Items Added\", leave it allowed (System Settings → General → Login Items)."
  say "To exit kiosk mode press Cmd+Q. To undo this, Settings → Open at startup shows the command."
fi
