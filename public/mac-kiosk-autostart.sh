#!/bin/bash
# Sets up a Mac to open the kiosk in Chrome kiosk mode at every login
# (docs/kiosk-setup.md, "macOS"). Finish the setup guide in Chrome first, then
# run this as the user the kiosk signs in as (the kiosk's Settings → Open at
# startup shows this command with its own address):
#
#   curl -fsSL <kiosk>/mac-kiosk-autostart.sh | bash -s -- --url <kiosk>/
#
# To undo it, putting back what it changed:
#
#   curl -fsSL <kiosk>/mac-kiosk-autostart.sh | bash -s -- --uninstall
#
# Pass options after `bash -s --`, e.g. `... | bash -s -- --url <kiosk>/ --dry-run`.

set -euo pipefail

LABEL="dev.drey.kiosk-video-nfc"
# Earlier versions of this script used this label. A Mac set up by one keeps it,
# so that running the setup again or --uninstall finds what that version set up.
OLD_LABEL="dev.drey.topps-kiosk"
if [[ ! -e "$HOME/Library/LaunchAgents/$LABEL.plist" && ! -d "$HOME/Library/Application Support/$LABEL" ]] \
   && [[ -e "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" || -d "$HOME/Library/Application Support/$OLD_LABEL" ]]; then
  LABEL="$OLD_LABEL"
fi
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
# What setup changed and what was set before, so --uninstall can put it back.
STATE="$HOME/Library/Application Support/$LABEL/install-state"
URL=""
URL_GIVEN=0
DRY_RUN=0
UNINSTALL=0
KIOSK_USER="$(id -un)"

say()  { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die()  { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: mac-kiosk-autostart.sh --url <https-url> [--dry-run]
       mac-kiosk-autostart.sh --uninstall [--dry-run]

  --url <url>   The kiosk's address, opened at login
  --dry-run     Show what would change without changing anything
  --uninstall   Undo the setup, putting back what it changed

Sets up:
  - a LaunchAgent that opens Chrome in kiosk mode at login
  - Google Chrome removed from Login Items, and "Reopen windows" off,
    so Chrome isn't already running when the kiosk command runs
  - automatic login for this user (asks for passwords; needs FileVault off)

It saves what was set before. --uninstall removes the LaunchAgent, puts Login
Items, "Reopen windows" and automatic login back as they were (asks for an
admin password), and opens the kiosk once so its settings show it no longer
opens at startup.
EOF
}

while (($#)); do
  case "$1" in
    --url) [[ $# -ge 2 ]] || die "--url needs a value"; URL="$2"; URL_GIVEN=1; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[[ "$(uname -s)" == Darwin ]] || die "this script is for macOS"
((EUID != 0)) || die "run it as the kiosk's user, without sudo (it asks for an admin password when it needs one)"
((!(UNINSTALL && URL_GIVEN))) || die "--uninstall doesn't take --url: it reads the address from the setup it undoes"
((UNINSTALL || URL_GIVEN)) || die "--url is missing. Copy the command from the kiosk's Settings → Open at startup."

# The kiosk sees ?autostart and marks "Opens at startup" done in its setup checklist.
LAUNCH_URL=""
if ((URL_GIVEN)); then
  [[ "$URL" =~ ^https://[^[:space:]#]+$ ]] || die "--url must be an https:// address without a #, got: $URL"
  if [[ "$URL" == *\?* ]]; then LAUNCH_URL="$URL&autostart"; else LAUNCH_URL="$URL?autostart"; fi
fi

has_tty() { { : </dev/tty; } 2>/dev/null; }

autologin_user() { defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true; }

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
  tmp="$(mktemp -t kiosk-video-nfc)"
  if [[ -f "$STATE" ]]; then grep -v "^$1=" "$STATE" >"$tmp" || true; fi
  printf '%s=%s\n' "$1" "$2" >>"$tmp"
  mv "$tmp" "$STATE"
}

# Keeps the first value: a second run mustn't save this script's own change as the one to restore.
state_set_once() { state_get "$1" >/dev/null || state_set "$1" "$2"; }

# ---- Setup ----

write_agent() {
  local tmp arg
  tmp="$(mktemp -t kiosk-video-nfc)"
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
  current="$(autologin_user)"
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
     && [[ "$(autologin_user)" == "$KIOSK_USER" ]]; then
    state_set_once autologin "$current"
    say "✓ Automatic login is on for $KIOSK_USER"
  else
    warn "couldn't turn on automatic login. Turn it on in System Settings → Users & Groups (needs an admin)."
  fi
}

set_up() {
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
    say "To exit kiosk mode press Cmd+Q. To undo this, run the script with --uninstall (Settings → Open at startup shows the command)."
  fi
}

# ---- Uninstall ----

# The address the LaunchAgent opens: its last argument.
agent_launch_url() {
  local n
  n="$(plutil -extract ProgramArguments raw -o - "$AGENT" 2>/dev/null)" || return 1
  [[ "$n" =~ ^[0-9]+$ ]] && ((n > 0)) || return 1
  plutil -extract "ProgramArguments.$((n - 1))" raw -o - "$AGENT" 2>/dev/null
}

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
  if [[ "$(autologin_user)" != "$KIOSK_USER" ]]; then
    say "✓ Automatic login isn't on for $KIOSK_USER (left as it is)"
    return
  fi
  autologin_off
  if [[ -n "$1" && "$1" != "$KIOSK_USER" ]]; then
    say "Before the kiosk setup, $1 logged in automatically. To turn that back on, use System Settings → Users & Groups (it needs $1's password)."
  fi
}

# Set up by an older version of this script, which didn't save what it changed.
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
  # Empty when nothing was set up, so there's no saved address to tell.
  if [[ ! "$url" =~ ^https://[^[:space:]#]+[?\&]autostart$ ]]; then
    say "If the kiosk's settings still say it opens at startup, open the kiosk in Chrome with ?autostart=removed added to its address."
    return
  fi
  url="${url}=removed"
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

uninstall() {
  local launch_url before path
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
}

if ((UNINSTALL)); then uninstall; else set_up; fi
