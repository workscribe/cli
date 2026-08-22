#!/usr/bin/env sh
# Workscribe one-liner installer
# Usage: curl -fsSL https://workscribe.co/install | sh

set -e

REPO="workscribe/workscribe"
BIN_NAME="workscribe"
INSTALL_DIR="${WORKSCRIBE_INSTALL_DIR:-/usr/local/bin}"

# ── Detect platform ────────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  PLATFORM="macos-arm64" ;;
      x86_64) PLATFORM="macos-x64" ;;
      *)      echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64)  PLATFORM="linux-x64" ;;
      aarch64) PLATFORM="linux-arm64" ;;
      *)       echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    echo "Install via npm instead: npm install -g @workscribe/cli" >&2
    exit 1
    ;;
esac

# ── Resolve latest version ─────────────────────────────────────────────────────
if command -v curl > /dev/null 2>&1; then
  FETCH="curl -fsSL"
elif command -v wget > /dev/null 2>&1; then
  FETCH="wget -qO-"
else
  echo "curl or wget is required" >&2
  exit 1
fi

echo "Fetching latest Workscribe release…"
LATEST=$($FETCH "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')

if [ -z "$LATEST" ]; then
  echo "Could not determine latest version. Check https://github.com/$REPO/releases" >&2
  exit 1
fi

# ── Download binary ────────────────────────────────────────────────────────────
URL="https://github.com/$REPO/releases/download/$LATEST/workscribe-$PLATFORM"
TMP="$(mktemp)"

echo "Downloading workscribe $LATEST ($PLATFORM)…"
$FETCH "$URL" > "$TMP"
chmod +x "$TMP"

# ── Install ────────────────────────────────────────────────────────────────────
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "$INSTALL_DIR/$BIN_NAME"
else
  echo "Installing to $INSTALL_DIR (sudo required)…"
  sudo mv "$TMP" "$INSTALL_DIR/$BIN_NAME"
fi

echo ""
echo "Workscribe $LATEST installed to $INSTALL_DIR/$BIN_NAME"
echo "Run: workscribe init"
