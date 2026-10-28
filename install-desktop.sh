#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
mkdir -p "$APP_DIR" "$ICON_DIR"
chmod +x "$ROOT_DIR/launch-desktop.sh" "$ROOT_DIR/dev.sh"
install -m 644 "$ROOT_DIR/app_icon.jpg" "$ICON_DIR/chess-tutor.jpg"
cat > "$APP_DIR/chess-tutor.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Chess Tutor
Comment=Play chess and get coaching
Exec="$ROOT_DIR/launch-desktop.sh"
Icon=${XDG_DATA_HOME:-$HOME/.local/share}/pixmaps/chess-tutor.jpg
Terminal=false
Categories=Game;Education;
StartupNotify=true
StartupWMClass=ChessTutor
EOF
chmod 644 "$APP_DIR/chess-tutor.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$APP_DIR" || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" 2>/dev/null || true
fi
# GNOME may cache launcher icons until its shell is restarted; replace the old icon file too.
mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/pixmaps"
install -m 644 "$ROOT_DIR/app_icon.jpg" "${XDG_DATA_HOME:-$HOME/.local/share}/pixmaps/chess-tutor.jpg"
echo "Installed Chess Tutor in $APP_DIR/chess-tutor.desktop"
echo "Open the applications menu, search for Chess Tutor, then pin it to your Dock."
