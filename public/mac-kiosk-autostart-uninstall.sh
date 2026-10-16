#!/bin/bash
# Undoes mac-kiosk-autostart.sh: the Mac stops opening the kiosk at login, and
# the settings that script changed go back to how they were before it ran
# (docs/kiosk-setup.md, "macOS"). Run it as the user the kiosk signs in as:
#
#   curl -fsSL https://topps.drey.dev/mac-kiosk-autostart-uninstall.sh | bash
#
# Pass options after `bash -s --`, e.g. `... | bash -s -- --dry-run`.

set -euo pipefail

LABEL="dev.drey.topps-kiosk"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
# Written by mac-kiosk-autostart.sh: what it changed, and what was set before.
STATE="$HOME/Library/Application Support/$LABEL/install-state"
DEFAULT_LAUNCH_URL="https://topps.drey.dev/?autostart"
DRY_RUN=0
KIOSK_USER="$(id -un)"

say()  { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die()  { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: mac-kiosk-autostart-uninstall.sh [--dry-run]

  --dry-run     Show what would change without changing anything

Undoes mac-kiosk-autostart.sh:
  - removes the LaunchAgent that opens Chrome in kiosk mode at login
  - puts Google Chrome back in Login Items and "Reopen windows" back as they
    were, if that script changed them
  - turns off automatic login, if that script turned it on (asks for an admin
    password)
  - opens the kiosk in Chrome once, so its settings show it no longer opens
    at startup
EOF
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[[ "$(uname -s)" == Darwin ]] || die "this script is for macOS"
((EUID != 0)) || die "run it as the kiosk's user, without sudo (it asks for an admin password when it needs one)"

has_tty() { { : </dev/tty; } 2>/dev/null; }

# Same format mac-kiosk-autostart.sh writes: key=value lines, read here, never sourced.
state_get() {
  local line
  [[ -f "$STATE" ]] || return 1
  while IFS= read -r line; do
    [[ "${line%%=*}" == "$1" ]] && { printf '%s' "${line#*=}"; return 0; }
  done <"$STATE"
  return 1
}

# The address the LaunchAgent opens: its last argument.
agent_launch_url() {
  local n
  n="$(plutil -extract ProgramArguments raw -o - "$AGENT" 2>/dev/null)" || return 1
  [[ "$n" =~ ^[0-9]+$ ]] && ((n > 0)) || return 1
  plutil -extract "ProgramArguments.$((n - 1))" raw -o - "$AGENT" 2>/dev/null
}

autologin_user() { defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true; }

remove_agent() {
  if [[ ! -e "$AGENT" ]]; then
    say "✓ No LaunchAgent to remove"
  elif ((DRY_RUN)); then
    say "Would remove $AGENT"
  else
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    rm -f "$AGENT"
    say "✓ Removed $AGENT. The kiosk no longer opens at login."
  fi
}

# $1: the value saved before setup (true, false or unset).
restore_reopen_windows() {
  case "$1" in
    true|false)
      if ((DRY_RUN)); then say "Would set \"Reopen windows when logging back in\" back to $1"; return; fi
      defaults write com.apple.loginwindow TALLogoutSavesState -bool "$1"
      ;;
    unset)
      if ((DRY_RUN)); then say "Would set \"Reopen windows when logging back in\" back to the macOS default"; return; fi
      defaults delete com.apple.loginwindow TALLogoutSavesState >/dev/null 2>&1 || true
      ;;
    *) warn "unexpected saved value for \"Reopen windows\": $1. Left it as it is."; return ;;
  esac
  say "✓ \"Reopen windows when logging back in\" is back as it was"
}

# $1: path of the Google Chrome login item the setup removed.
restore_chrome_login_item() {
  if [[ "$1" != /*.app || ! -d "$1" ]]; then
    warn "Google Chrome was in Login Items, but $1 isn't there anymore. Add Chrome back in System Settings → General → Login Items if you want it."
    return
  fi
  if ((DRY_RUN)); then say "Would add $1 back to Login Items"; return; fi
  # The path goes in as an argument, so it can't change the script.
  if osascript -e 'on run argv
      tell application "System Events" to make login item at end with properties {path:(item 1 of argv), hidden:false}
    end run' "$1" >/dev/null 2>&1; then
    say "✓ Google Chrome is back in Login Items"
  else
    warn "couldn't add Google Chrome back to Login Items. Add it in System Settings → General → Login Items."
  fi
}

autologin_off() {
  if ((DRY_RUN)); then say "Would turn off automatic login for $KIOSK_USER"; return; fi
  if ! has_tty; then
    warn "no terminal to ask for a password, so automatic login is still on. To turn it off: sudo sysadminctl -autologin off"
    return
  fi
  say "Turning off automatic login (sudo asks for an admin password)…"
  if sudo sysadminctl -autologin off </dev/tty && [[ -z "$(autologin_user)" ]]; then
    say "✓ Automatic login is off"
  else
    warn "couldn't turn off automatic login. Turn it off in System Settings → Users & Groups (needs an admin)."
  fi
}

# $1: who logged in automatically before setup turned it on for this user (may be empty).
restore_autologin() {
  local current
  current="$(autologin_user)"
  if [[ "$current" != "$KIOSK_USER" ]]; then
    say "✓ Automatic login isn't on for $KIOSK_USER (left as it is)"
    return
  fi
  autologin_off
  if [[ -n "$1" && "$1" != "$KIOSK_USER" ]]; then
    say "Before the kiosk setup, $1 logged in automatically. To turn that back on, use System Settings → Users & Groups (it needs $1's password)."
  fi
}

# Set up by an older mac-kiosk-autostart.sh, which didn't save what it changed.
ask_autologin_off() {
  [[ "$(autologin_user)" == "$KIOSK_USER" ]] || return 0
  if ((DRY_RUN)); then say "Would ask whether to turn off automatic login for $KIOSK_USER"; return; fi
  if ! has_tty; then
    say "Automatic login is on for $KIOSK_USER. If it wasn't before the kiosk setup, turn it off: sudo sysadminctl -autologin off"
    return
  fi
  local answer
  read -rp "Automatic login is on for $KIOSK_USER. Turn it off? [y/N] " answer </dev/tty
  if [[ "$answer" == [yY]* ]]; then autologin_off; else say "Automatic login was left on."; fi
}

# The kiosk can't see LaunchAgents: it remembers being opened with ?autostart.
# Opening it with ?autostart=removed makes it forget that.
tell_kiosk() {
  local url="$1"
  [[ "$url" == *autostart ]] || url="$DEFAULT_LAUNCH_URL"
  url="${url}=removed"
  [[ "$url" =~ ^https://[^[:space:]#]+[?\&]autostart=removed$ ]] || url="$DEFAULT_LAUNCH_URL=removed"
  if ! open -Ra "Google Chrome" >/dev/null 2>&1; then
    say "Google Chrome isn't installed. If the kiosk is set up in another Chrome, open $url there to update its settings."
    return
  fi
  if ((DRY_RUN)); then say "Would open $url in Google Chrome"; return; fi
  if open -a "Google Chrome" "$url"; then
    say "✓ Chrome opens a tab saying the kiosk no longer opens at startup. Close that tab."
  else
    warn "couldn't open Chrome. Open $url in Chrome to update the kiosk's settings."
  fi
}

remove_state() {
  ((DRY_RUN)) && return
  rm -f "$STATE"
  rmdir "$(dirname "$STATE")" 2>/dev/null || true
}

((DRY_RUN)) && say "Dry run: nothing will be changed."

if [[ -f "$STATE" ]]; then
  launch_url="$(state_get launch_url || agent_launch_url || true)"
  remove_agent
  if before="$(state_get reopen_windows)"; then restore_reopen_windows "$before"; fi
  if path="$(state_get chrome_login_item)"; then restore_chrome_login_item "$path"; fi
  if before="$(state_get autologin)"; then restore_autologin "$before"; fi
  remove_state
elif [[ -e "$AGENT" ]]; then
  launch_url="$(agent_launch_url || true)"
  remove_agent
  # The older script always turned "Reopen windows" off, and macOS has it on by default.
  if [[ "$(defaults read com.apple.loginwindow TALLogoutSavesState 2>/dev/null || true)" == 0 ]]; then
    restore_reopen_windows unset
  fi
  say "If Google Chrome used to open at login, add it back in System Settings → General → Login Items."
  ask_autologin_off
else
  launch_url=""
  say "Nothing to remove: this Mac isn't set up to open the kiosk at login."
fi

tell_kiosk "$launch_url"

if ((!DRY_RUN)); then
  say ""
  say "Done. The kiosk won't open by itself after a restart."
fi
