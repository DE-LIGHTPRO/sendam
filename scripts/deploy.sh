#!/usr/bin/env bash
# Deploys Sendam to NEAR testnet under an account you own, and writes the settings the
# site and the verifier need.
#
#   npm run deploy -- your-name.testnet
#
# Needs: Rust, cargo-near and near-cli-rs (see the README), and a funded testnet account
# whose key is in the legacy keychain (~/.near-credentials). It creates three sub-accounts:
#   usdc.<you>      the test USDC token        (about 3 NEAR)
#   sendam.<you>    the Sendam contract        (about 4 NEAR)
#   verifier.<you>  the account that confirms paid bills (0.5 NEAR)
set -euo pipefail

OWNER="${1:-}"
if [[ -z "$OWNER" || "$OWNER" != *.testnet ]]; then
  echo "Usage: npm run deploy -- your-name.testnet" >&2
  exit 1
fi
NET="network-config testnet"
USDC="usdc.$OWNER"
SENDAM="sendam.$OWNER"
VERIFIER="verifier.$OWNER"
cd "$(dirname "$0")/.."

for tool in cargo-near near node; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See 'Deploy it yourself' in the README." >&2; exit 1; }
done

echo "==> Building the contracts"
(cd contracts/mock-usdc && cargo near build non-reproducible-wasm)
(cd contracts/sendam && cargo near build non-reproducible-wasm)
USDC_WASM=$(find contracts/target/near -name 'mock_usdc.wasm' | head -1)
SENDAM_WASM=$(find contracts/target/near -name 'sendam.wasm' | head -1)
[[ -f "$USDC_WASM" && -f "$SENDAM_WASM" ]] || { echo "Build output not found under contracts/target/near" >&2; exit 1; }

create() { # account, balance
  if near account view-account-summary "$1" $NET now >/dev/null 2>&1; then
    echo "    $1 already exists, keeping it"
  else
    near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-legacy-keychain \
      sign-as "$OWNER" $NET sign-with-legacy-keychain send
  fi
}

echo "==> Creating accounts"
create "$USDC" '3 NEAR'
create "$SENDAM" '4 NEAR'
create "$VERIFIER" '0.5 NEAR'

echo "==> Deploying the test USDC token"
near contract deploy "$USDC" use-file "$USDC_WASM" with-init-call new json-args '{}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET sign-with-legacy-keychain send

echo "==> Deploying Sendam"
near contract deploy "$SENDAM" use-file "$SENDAM_WASM" with-init-call new \
  json-args "{\"owner\":\"$OWNER\",\"usdc\":\"$USDC\",\"verifier\":\"$VERIFIER\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' $NET sign-with-legacy-keychain send

echo "==> Letting Sendam hold test USDC"
near contract call-function as-transaction "$USDC" register json-args "{\"account_id\":\"$SENDAM\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as "$OWNER" $NET sign-with-legacy-keychain send

echo "==> Pointing the site at the new contracts"
node -e '
  const fs = require("fs");
  const [contract, usdc] = process.argv.slice(1);
  const p = "js/config.js";
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(/export const CONTRACT = .*;/, `export const CONTRACT = ${JSON.stringify(contract)};`);
  s = s.replace(/export const USDC = .*;/, `export const USDC = ${JSON.stringify(usdc)};`);
  fs.writeFileSync(p, s);
' "$SENDAM" "$USDC"

echo "==> Writing .env for the verifier (kept out of git)"
node -e '
  const fs = require("fs"), os = require("os"), path = require("path");
  const [contract, verifier] = process.argv.slice(1);
  const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".near-credentials", "testnet", `${verifier}.json`), "utf8"));
  const old = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : fs.readFileSync(".env.example", "utf8");
  const set = (text, k, v) => (new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`);
  let s = set(old, "SENDAM_CONTRACT", contract);
  s = set(s, "VERIFIER_ACCOUNT", verifier);
  s = set(s, "VERIFIER_PRIVATE_KEY", cred.private_key);
  fs.writeFileSync(".env", s, { mode: 0o600 });
' "$SENDAM" "$VERIFIER"

cat <<DONE

Done.
  Sendam contract:  $SENDAM
  Test USDC:        $USDC
  Verifier:         $VERIFIER

Next:
  1. Add your VTpass sandbox keys to .env (VTPASS_API_KEY and VTPASS_SECRET_KEY).
  2. Try it locally:   npm run serve   then open http://localhost:4300
  3. On Vercel, add the same names and values from .env under
     Project > Settings > Environment Variables, then redeploy.
     Copy VERIFIER_PRIVATE_KEY straight from .env into Vercel. Never paste it into a chat.
  4. Commit js/config.js (it holds only the public contract names) and push.
DONE
