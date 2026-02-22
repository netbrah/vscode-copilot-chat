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
#   ./script/build-and-install.sh              # default: pull + build + install (local only)
#   ./script/build-and-install.sh --no-pull    # skip git pull (build from working tree)
#   ./script/build-and-install.sh --no-install # build only, don't install anywhere
#   ./script/build-and-install.sh --remote     # also deploy to remote SSH host
#   ./script/build-and-install.sh --remote-only # deploy existing VSIX to remote (no build)
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

# Remote SSH deploy config (matches update_mastra.sh pattern)
REMOTE_SSH_KEY="$HOME/.ssh/id_ed25519_mac2"
REMOTE_HOST="palanisd@172.29.61.251"
REMOTE_EXT_DIR="~/.vscode-server-insiders/extensions"

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
DO_REMOTE=false
REMOTE_ONLY=false

for arg in "$@"; do
	case "$arg" in
		--no-pull)     DO_PULL=false ;;
		--no-install)  DO_INSTALL=false ;;
		--remote)      DO_REMOTE=true ;;
		--remote-only) REMOTE_ONLY=true; DO_PULL=false; DO_INSTALL=false ;;
		--help|-h)
			echo "Usage: $0 [--no-pull] [--no-install] [--remote] [--remote-only]"
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

# ── Remote-only shortcut ────────────────────────────────────────────
# Skip the entire build pipeline — just find the latest VSIX and deploy it.
if $REMOTE_ONLY; then
	cd "$REPO_ROOT"
	VSIX_FILE=$(ls -t "$REPO_ROOT"/copilot-chat-*.vsix 2>/dev/null | head -1)
	if [[ -z "$VSIX_FILE" ]]; then
		fail "No existing .vsix found. Run a full build first."
	fi
	PERSONAL_VERSION=$(echo "$(basename "$VSIX_FILE")" | sed 's/copilot-chat-//; s/\.vsix//')
	UPSTREAM_VERSION=$(node -p "require('./package.json').version")
	CURRENT_BRANCH=$(git branch --show-current)
	BUILD_LABEL="remote-only"
	log "Remote-only deploy: $(basename "$VSIX_FILE")"
fi

# ── Step 1: Pull latest ─────────────────────────────────────────────
cd "$REPO_ROOT"

if ! $REMOTE_ONLY; then

if $DO_PULL; then
	CURRENT_PULL_BRANCH=$(git branch --show-current)

	# Strategy: always sync from upstream (Microsoft) main, then rebase
	# local branch on top. This keeps our custom commits cleanly stacked.
	# If upstream remote doesn't exist, fall back to origin.
	if git remote get-url upstream &>/dev/null; then
		log "Fetching latest from upstream ($(git remote get-url upstream))..."
		git fetch upstream main || fail "git fetch upstream failed"

		if [[ "$CURRENT_PULL_BRANCH" == "main" ]]; then
			# On main: fast-forward to upstream/main
			git merge --ff-only upstream/main || fail "Cannot fast-forward main — resolve divergence first"
		else
			# On feature branch: rebase our commits onto upstream/main
			# Auto-stash dirty working tree so rebase can proceed
			log "Rebasing $CURRENT_PULL_BRANCH onto upstream/main..."
			git rebase --autostash upstream/main || fail "Rebase failed — resolve conflicts with: git rebase --continue"
		fi
	else
		# No upstream remote — try origin pull (original behavior)
		log "Pulling latest from origin ($(git remote get-url origin))..."
		git pull --ff-only origin "$CURRENT_PULL_BRANCH" || fail "git pull failed — resolve conflicts first"
	fi
	log "Sync complete."
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

# Save original files for post-build cleanup
cp package.json package.json.bak
cp README.md README.md.bak 2>/dev/null || true
cp CHANGELOG.md CHANGELOG.md.bak 2>/dev/null || true

# Cleanup trap — restore originals after script exits (success or failure)
cleanup_build_mutations() {
	cd "$REPO_ROOT"
	[[ -f package.json.bak ]] && mv package.json.bak package.json
	[[ -f README.md.bak ]] && mv README.md.bak README.md
	[[ -f CHANGELOG.md.bak ]] && mv CHANGELOG.md.bak CHANGELOG.md
}
trap cleanup_build_mutations EXIT

node -e "
	const fs = require('fs');
	const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
	pkg.version = '${PERSONAL_VERSION}';
	pkg.displayName = 'GitHub Copilot Chat${DISPLAY_SUFFIX}';
	pkg.description = 'AI chat features powered by Copilot | ${BUILD_LABEL} | built: ${BUILD_DATE}';
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

npx @vscode/vsce package 2>&1 | tail -5

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

fi # end !REMOTE_ONLY

# ── Step 7: Remote SSH deploy ────────────────────────────────────────
# Pattern: SCP the VSIX, extract new version, symlink old → new.
# The VS Code --remote CLI flag is unreliable without an active SSH session,
# so we do it the update_mastra way: direct filesystem manipulation.
#
# IMPORTANT: We do NOT delete old extension directories immediately.
# The extension host loads code into memory at startup, but worker threads
# (e.g. tikTokenizerWorker.js) are spawned on-demand and resolve paths from
# disk. Deleting the old dir mid-session breaks workers. Instead we:
#   1. Extract the new version alongside the old
#   2. Symlink old dir name → new dir (so worker path resolution still works)
#   3. On next reload, VS Code picks up the new version cleanly
if $DO_REMOTE || $REMOTE_ONLY; then
	EXT_DIR_NAME="github.copilot-chat-${PERSONAL_VERSION}"

	# Connectivity check (same pattern as update_mastra.sh)
	if [[ ! -f "$REMOTE_SSH_KEY" ]]; then
		log "Remote deploy: SSH key not found at $REMOTE_SSH_KEY — skipping."
	elif ! ssh -i "$REMOTE_SSH_KEY" -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE_HOST" 'echo ok' &>/dev/null; then
		log "Remote deploy: Cannot reach $REMOTE_HOST — skipping (VPN?)."
	else
		log "Deploying to remote: $REMOTE_HOST"

		# SCP the VSIX
		scp -i "$REMOTE_SSH_KEY" "$VSIX_FILE" "$REMOTE_HOST:/tmp/copilot-chat-latest.vsix"

		# Extract new version, symlink old dirs → new so workers don't break
		ssh -i "$REMOTE_SSH_KEY" "$REMOTE_HOST" bash -lc "'
			mkdir -p /tmp/copilot-extract \
			&& cd /tmp/copilot-extract \
			&& unzip -qo /tmp/copilot-chat-latest.vsix \
			&& rm -rf $REMOTE_EXT_DIR/$EXT_DIR_NAME \
			&& mv extension $REMOTE_EXT_DIR/$EXT_DIR_NAME \
			&& for old_dir in $REMOTE_EXT_DIR/github.copilot-chat-*; do
				if [ -d \"\$old_dir\" ] && [ \"\$(basename \"\$old_dir\")\" != \"$EXT_DIR_NAME\" ]; then
					rm -rf \"\$old_dir\"
					ln -sf \"$EXT_DIR_NAME\" \"\$old_dir\"
				fi
			done \
			&& rm -rf /tmp/copilot-extract /tmp/copilot-chat-latest.vsix \
			&& echo DONE
		'"

		log "Remote deploy complete. Running sessions preserved via symlink."
		log "Reload SSH window to activate new version."
	fi
else
	log "Skipping remote deploy (use --remote to enable)."
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  Version:  ${PERSONAL_VERSION} (upstream ${UPSTREAM_VERSION})"
echo "  Branch:   ${CURRENT_BRANCH} (${BUILD_LABEL})"
echo "  VSIX:     $(basename "$VSIX_FILE")"
echo "  Built:    $(date '+%Y-%m-%d %H:%M:%S')"
$DO_INSTALL && echo "  Local:    Restart VS Code Insiders to pick up changes."
($DO_REMOTE || $REMOTE_ONLY) && echo "  Remote:   $REMOTE_HOST — reload SSH window to activate."
echo "════════════════════════════════════════════════════"
