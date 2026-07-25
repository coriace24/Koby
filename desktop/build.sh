#!/usr/bin/env bash
# Builds the Windows desktop package: dist/Koby.exe + dist/app.zip
# Run from the repo root:  bash desktop/build.sh
# Requires: node/npm, network access (Node runtime + Prisma engine downloads).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
PAYLOAD="$DIST/payload"
CACHE="${KOBY_BUILD_CACHE:-$HOME/.cache/koby-desktop}"
NODE_VERSION="${KOBY_NODE_VERSION:-22.14.0}"
VERSION="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)-$(date -u +%Y%m%d%H%M)"

echo "==> Building Koby desktop package (version $VERSION)"
mkdir -p "$DIST" "$CACHE"
rm -rf "$PAYLOAD" "$DIST/app.zip"
mkdir -p "$PAYLOAD"

echo "==> 1/7 Next.js standalone build"
cd "$ROOT"
npm run build

echo "==> 2/7 Prisma client (windows engine)"
npx prisma@6.19.3 generate

echo "==> 3/7 Assembling server payload"
mkdir -p "$PAYLOAD/server"
cp -r "$ROOT/.next/standalone/." "$PAYLOAD/server/"
mkdir -p "$PAYLOAD/server/.next/static"
cp -r "$ROOT/.next/static/." "$PAYLOAD/server/.next/static/"
[ -d "$ROOT/public" ] && cp -r "$ROOT/public" "$PAYLOAD/server/public"
# Make sure the generated Prisma client (with the windows query engine) is present
mkdir -p "$PAYLOAD/server/node_modules/.prisma"
cp -r "$ROOT/node_modules/.prisma/client" "$PAYLOAD/server/node_modules/.prisma/client"
cp -r "$ROOT/node_modules/@prisma/client" "$PAYLOAD/server/node_modules/@prisma/client" 2>/dev/null || true
# Prune everything Windows will never load: linux engines, per-database WASM
# engine payloads (we use the native windows dll), linux image codecs, types/maps.
find "$PAYLOAD/server/node_modules" \( \
    -name "*debian*" -o -name "*linux*" -o -name "*.so.node" \
    -o -name "query_engine_bg.*" -o -name "query_compiler_bg.*" -o -name "*.wasm" \
    -o -name "*.d.ts" -o -name "*.js.map" -o -name "*.mjs.map" \
  \) -type f -delete 2>/dev/null || true
rm -rf "$PAYLOAD/server/node_modules/@img" \
       "$PAYLOAD/server/node_modules/sharp" 2>/dev/null || true
# The generated client's node entry (index.js) only uses @prisma/client/runtime/library.js
# plus the engine dll in its own folder — the duplicate "client/" trees are unused.
rm -rf "$PAYLOAD/server/node_modules/.prisma/client/client" \
       "$PAYLOAD/server/node_modules/@prisma/client/client" 2>/dev/null || true

echo "==> 4/7 Bundling Node.js runtime for Windows"
NODE_ZIP="$CACHE/node-v$NODE_VERSION-win-x64.zip"
if [ ! -f "$NODE_ZIP" ]; then
  curl -fSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" -o "$NODE_ZIP"
fi
mkdir -p "$PAYLOAD/node"
unzip -jo "$NODE_ZIP" "node-v$NODE_VERSION-win-x64/node.exe" -d "$PAYLOAD/node" > /dev/null

echo "==> 5/7 Bundling Prisma CLI + Windows schema engine"
mkdir -p "$PAYLOAD/prisma" "$PAYLOAD/prisma-cli" "$PAYLOAD/engines" "$PAYLOAD/template"
cp "$ROOT/prisma/schema.prisma" "$PAYLOAD/prisma/schema.prisma"
( cd "$PAYLOAD/prisma-cli" && npm install prisma@6.19.3 --no-save --no-audit --no-fund --silent \
    --prefix "$PAYLOAD/prisma-cli" )
# The CLI's bundled linux engines are dead weight — the launcher points
# PRISMA_SCHEMA_ENGINE_BINARY at the windows engine we ship in engines/.
find "$PAYLOAD/prisma-cli/node_modules" \( \
    -name "*debian*" -o -name "*linux*" -o -name "*.so.node" \
    -o -name "*.d.ts" -o -name "*.js.map" \
  \) -type f -delete 2>/dev/null || true
ENGINE_HASH="$(node -e "console.log(require('$ROOT/node_modules/@prisma/engines-version/package.json').prisma.enginesVersion)")"
ENGINE_GZ="$CACHE/schema-engine-windows-$ENGINE_HASH.exe.gz"
if [ ! -f "$ENGINE_GZ" ]; then
  curl -fSL "https://binaries.prisma.sh/all_commits/$ENGINE_HASH/windows/schema-engine.exe.gz" -o "$ENGINE_GZ"
fi
gunzip -kc "$ENGINE_GZ" > "$PAYLOAD/engines/schema-engine-windows.exe"

echo "==> 6/7 Blank template database"
rm -f "$DIST/template.db"
DATABASE_URL="file:$DIST/template.db" npx prisma@6.19.3 db push --skip-generate --schema "$ROOT/prisma/schema.prisma" > /dev/null
cp "$DIST/template.db" "$PAYLOAD/template/koby.db"

echo "$VERSION" > "$PAYLOAD/version.txt"

# Fallback path: the extracted app.zip is runnable on its own via Start Koby.bat,
# which uses the bundled (signed) node.exe — no exe packaging involved.
cp "$ROOT/desktop/launcher.js" "$PAYLOAD/launcher.js"
cp "$ROOT/desktop/start-koby.bat" "$PAYLOAD/Start Koby.bat"
mkdir -p "$PAYLOAD/node_modules"
cp -r "$ROOT/desktop/node_modules/adm-zip" "$PAYLOAD/node_modules/adm-zip"

echo "==> 7/7 Zipping payload and compiling Koby.exe"
( cd "$PAYLOAD" && zip -q -9 -r "$DIST/app.zip" . )
cd "$ROOT/desktop"
[ -d node_modules ] || npm install --no-audit --no-fund --silent
npx pkg launcher.js --targets node22-win-x64 --output "$DIST/Koby.exe"

echo "==> Done:"
ls -lh "$DIST/Koby.exe" "$DIST/app.zip"
