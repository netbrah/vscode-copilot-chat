#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# build-and-install.sh — Pull, build, and install personal Copilot VSIX
#
# One-shot script: pulls latest from fork, builds the extension,
# packages the VSIX, and installs it into VS Code Insiders.
#
# OPSEC: This script is LOCAL-ONLY. It pulls but NEVER pushes.
# The personalPrompts.tsx contains domain-specific ONTAP instructions
# that must not be exposed to any remote. All customizations stay on
# this machine — the fork carries only the structural hooks.
#
# Usage:
#   ./script/build-and-install.sh            # default: pull + build + install
#   ./script/build-and-install.sh --no-pull  # skip git pull (build from working tree)
#   ./script/build-and-install.sh --no-install  # build only, don't install
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Safety: no pushes, ever ──────────────────────────────────────────
# Hardcoded guard. This script must never grow a push path.
readonly NO_PUSH=true

# ── Config ───────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXTENSION_ID="GitHub.copilot-chat"

# Personal build major version — always higher than marketplace 0.x.x
# so VS Code never auto-updates over our build.
# Versioning: PERSONAL_MAJOR.UPSTREAM_MINOR.YYYYMMDDNN
# Mirrors Microsoft's scheme (0.MINOR.YYYYMMDDNN) but with major=1.
# Example: upstream 0.38.0 → personal 1.38.2026022100
PERSONAL_MAJOR=1

# Detect VS Code binary (prefer Insiders)
if command -v code-insiders &>/dev/null; then
	VSCODE_CLI="code-insiders"
elif [[ -x "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" ]]; then
	VSCODE_CLI="/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
elif command -v code &>/dev/null; then
	VSCODE_CLI="code"
elif [[ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]]; then
	VSCODE_CLI="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
else
	echo "ERROR: No VS Code CLI found. Install 'code' or 'code-insiders' in PATH." >&2
	exit 1
fi

# ── Parse flags ──────────────────────────────────────────────────────
DO_PULL=true
DO_INSTALL=true

for arg in "$@"; do
	case "$arg" in
		--no-pull)    DO_PULL=false ;;
		--no-install) DO_INSTALL=false ;;
		--help|-h)
			echo "Usage: $0 [--no-pull] [--no-install]"
			exit 0
			;;
		*)
			echo "Unknown flag: $arg" >&2
			exit 1
			;;
	esac
done

# ── Helpers ──────────────────────────────────────────────────────────
log()  { echo "▸ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# ── Step 1: Pull latest ─────────────────────────────────────────────
cd "$REPO_ROOT"

if $DO_PULL; then
	log "Pulling latest from origin ($(git remote get-url origin))..."
	git pull --ff-only origin "$(git branch --show-current)" || fail "git pull failed — resolve conflicts first"
	log "Pull complete."
else
	log "Skipping pull (--no-pull)."
fi

# ── Step 2: Version bump ─────────────────────────────────────────────
# Read upstream version, rewrite as PERSONAL_MAJOR.MINOR.YYYYMMDDNN
# Mirrors Microsoft's date-stamped patch scheme. Each build gets a unique
# timestamp so rebuilds within the same day get NN=00,01,02...
# Non-main branches get -dev suffix in displayName (visible in Extensions panel).
# This is a local-only mutation — never pushed.
UPSTREAM_VERSION=$(node -p "require('./package.json').version")
UPSTREAM_MINOR=$(echo "$UPSTREAM_VERSION" | cut -d. -f2)
CURRENT_BRANCH=$(git branch --show-current)

# Generate date-stamped patch: YYYYMMDDNN
BUILD_DATE=$(date +%Y%m%d)
# Find existing builds from today to auto-increment NN
EXISTING_TODAY=$(ls "$REPO_ROOT"/copilot-chat-*.vsix 2>/dev/null | grep -o "${BUILD_DATE}[0-9][0-9]" | sort -r | head -1 || true)
if [[ -n "$EXISTING_TODAY" ]]; then
	LAST_NN=${EXISTING_TODAY: -2}
	NEXT_NN=$(printf "%02d" $(( 10#$LAST_NN + 1 )))
else
	NEXT_NN="00"
fi
BUILD_STAMP="${BUILD_DATE}${NEXT_NN}"

PERSONAL_VERSION="${PERSONAL_MAJOR}.${UPSTREAM_MINOR}.${BUILD_STAMP}"

# Dev branch tagging — encode branch in displayName + description
# Version number stays clean (vsce doesn't support semver prerelease tags)
# but the extension panel shows which branch built this VSIX.
if [[ "$CURRENT_BRANCH" == "main" ]]; then
	DISPLAY_SUFFIX=""
	BUILD_LABEL="release"
else
	# Shorten branch name for display (e.g., "feature/mastra-integration" → "mastra-integration")
	SHORT_BRANCH="${CURRENT_BRANCH##*/}"
	DISPLAY_SUFFIX=" [dev/${SHORT_BRANCH}]"
	BUILD_LABEL="dev/${SHORT_BRANCH}"
fi

log "Version bump: ${UPSTREAM_VERSION} → ${PERSONAL_VERSION} (${BUILD_LABEL})"
node -e "
	const fs = require('fs');
	const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
	pkg.version = '${PERSONAL_VERSION}';
	pkg.displayName = 'GitHub Copilot Chat${DISPLAY_SUFFIX}';
	if ('${DISPLAY_SUFFIX}') {
		pkg.description = pkg.description + ' | branch: ${BUILD_LABEL} | built: ${BUILD_DATE}';
	}
	fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
"

# ── Step 2b: Inject personal README + CHANGELOG ─────────────────────
# Replace stock README/CHANGELOG with personal versions for the Extensions panel.
# These are local-only mutations — reset on next pull.
TEMPLATE_DIR="$REPO_ROOT/script/templates"
if [[ -f "$TEMPLATE_DIR/README.personal.md" ]]; then
	log "Injecting personal README..."
	sed -e "s|{{VERSION}}|${PERSONAL_VERSION}|g" \
		-e "s|{{UPSTREAM}}|${UPSTREAM_VERSION}|g" \
		-e "s|{{BRANCH}}|${CURRENT_BRANCH}|g" \
		-e "s|{{BUILD_LABEL}}|${BUILD_LABEL}|g" \
		-e "s|{{BUILD_DATE}}|$(date '+%Y-%m-%d %H:%M')|g" \
		"$TEMPLATE_DIR/README.personal.md" > "$REPO_ROOT/README.md"
fi
if [[ -f "$REPO_ROOT/PERSONAL_CHANGELOG.md" ]]; then
	log "Injecting personal CHANGELOG..."
	cp "$REPO_ROOT/PERSONAL_CHANGELOG.md" "$REPO_ROOT/CHANGELOG.md"
fi

# ── Step 3: Install dependencies (if needed) ────────────────────────
if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
	log "Installing dependencies (npm ci)..."
	npm ci
else
	log "Dependencies up to date — skipping npm ci."
fi

# ── Step 4: Build ────────────────────────────────────────────────────
log "Building extension (esbuild --dev)..."
node --experimental-strip-types .esbuild.ts --dev 2>&1 | tail -5
log "Build complete."

# ── Step 5: Package VSIX ────────────────────────────────────────────
log "Packaging VSIX..."
# Clean old VSIX files
rm -f "$REPO_ROOT"/copilot-chat-*.vsix

npx @vscode/vsce package --no-dependencies 2>&1 | tail -5

# Find the freshly built VSIX
VSIX_FILE=$(ls -t "$REPO_ROOT"/copilot-chat-*.vsix 2>/dev/null | head -1)
if [[ -z "$VSIX_FILE" ]]; then
	fail "No .vsix file found after packaging."
fi
log "Packaged: $(basename "$VSIX_FILE")"

# ── Step 6: Install ─────────────────────────────────────────────────
if $DO_INSTALL; then
	log "Installing into VS Code ($(basename "$VSCODE_CLI"))..."

	# Uninstall stock extension first to avoid conflicts
	"$VSCODE_CLI" --uninstall-extension "$EXTENSION_ID" 2>/dev/null || true

	"$VSCODE_CLI" --install-extension "$VSIX_FILE" --force
	log "Installed. Restart VS Code to activate."
else
	log "Skipping install (--no-install). VSIX at: $VSIX_FILE"
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  Version:  ${PERSONAL_VERSION} (upstream ${UPSTREAM_VERSION})"
echo "  Branch:   ${CURRENT_BRANCH} (${BUILD_LABEL})"
echo "  VSIX:     $(basename "$VSIX_FILE")"
echo "  Built:    $(date '+%Y-%m-%d %H:%M:%S')"
$DO_INSTALL && echo "  Restart VS Code Insiders to pick up changes."
echo "════════════════════════════════════════════════════"
