#!/usr/bin/env bash
# scripts/build_ui.sh — robust UI build:
# - Verifies Node.js ≥ 18
# - Detects package manager (pnpm/yarn/npm)
# - Prefers frozen installs (ci/--frozen-lockfile) and falls back to install when lockfile is out-of-sync
# - Builds the UI (Vite) and verifies dist/

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ui="$root/ui"

if [[ ! -d "$ui" ]]; then
  echo "❌ ui/ not found at: $ui" >&2
  exit 2
fi

cd "$ui"

# --- Node / npm checks ---
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required. Install Node.js ≥ 18 (includes npm)." >&2
  exit 2
fi

# Ensure Node ≥ 18
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  echo "❌ Node.js ≥ 18 required. Found: $(node -v)" >&2
  exit 2
fi

# --- Package manager detection (prefer existing lockfile when tool exists) ---
pm="npm"
if [[ -f "pnpm-lock.yaml" ]] && command -v pnpm >/dev/null 2>&1; then
  pm="pnpm"
elif [[ -f "yarn.lock" ]] && command -v yarn >/dev/null 2>&1; then
  pm="yarn"
elif [[ -f "package-lock.json" ]]; then
  pm="npm"
fi

echo "🔧 Using package manager: $pm"
[[ -f package.json ]] || { echo "❌ Missing ui/package.json" >&2; exit 2; }

# --- Install dependencies with frozen strategy, fallback on mismatch ---
case "$pm" in
  pnpm)
    echo "📦 Installing deps (pnpm i --frozen-lockfile)…"
    if ! pnpm i --frozen-lockfile; then
      echo "ℹ️  Lockfile mismatch. Falling back to 'pnpm i' to refresh lockfile…"
      pnpm i
    fi
    build_cmd=(pnpm run build)
    ;;

  yarn)
    echo "📦 Installing deps (yarn install --frozen-lockfile)…"
    if ! yarn install --frozen-lockfile; then
      echo "ℹ️  Lockfile mismatch. Falling back to 'yarn install'…"
      yarn install
    fi
    build_cmd=(yarn build)
    ;;

  npm|*)
    if [[ -f "package-lock.json" ]]; then
      echo "📦 Installing UI deps (npm ci)…"
      if ! npm ci; then
        echo "ℹ️  Lockfile mismatch. Refreshing lockfile with 'npm install'…"
        npm install --no-fund --no-audit
      fi
    else
      echo "ℹ️  No package-lock.json detected; generating it with 'npm install'…"
      echo "    (Commit package-lock.json for reproducible builds.)"
      npm install --no-fund --no-audit
    fi
    build_cmd=(npm run build)
    ;;
esac

# --- Build ---
echo "🏗️  Building UI…"
"${build_cmd[@]}"

dist="$ui/dist"
if [[ ! -d "$dist" ]]; then
  echo "❌ Build failed: dist/ not found" >&2
  exit 1
fi

echo "✅ UI built at: $dist"
