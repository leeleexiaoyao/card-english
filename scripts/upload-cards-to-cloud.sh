#!/usr/bin/env bash
set -euo pipefail

START_INDEX="${1:-1}"
END_INDEX="${2:-9}"
LOCAL_DIR="${LOCAL_DIR:-miniprogram/images/cards-upload}"
CLOUD_DIR="${CLOUD_DIR:-cards-v2}"
TCB_ENV_ID="${TCB_ENV_ID:-cloud1-4gsbdd828457096e}"
HOME_DIR="${HOME_DIR:-/tmp/codex-home}"
XDG_DIR="${XDG_DIR:-$HOME_DIR/.config}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-/tmp/npmcache}"
OUT_JSON="${OUT_JSON:-scripts/card-fileids.json}"
BUCKET_NAME="${BUCKET_NAME:-}"

mkdir -p "$(dirname "$OUT_JSON")" "$HOME_DIR" "$XDG_DIR" "$NPM_CACHE_DIR"
printf "{}\n" > "$OUT_JSON"

format_index() {
  printf "%04d" "$1"
}

extract_last_json() {
  local raw="$1"
  python3 - "$raw" <<'PY'
import json
import re
import sys

raw = sys.argv[1]
raw = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", raw)
decoder = json.JSONDecoder()
best_obj = None
best_len = -1

for idx, ch in enumerate(raw):
    if ch != "{":
        continue
    try:
        obj, end = decoder.raw_decode(raw[idx:])
        if end > best_len:
            best_obj = obj
            best_len = end
    except Exception:
        continue

if best_obj is None:
    print("")
else:
    print(json.dumps(best_obj, ensure_ascii=False))
PY
}

append_mapping() {
  local key="$1"
  local file_id="$2"
  local cloud_path="$3"
  python3 - "$OUT_JSON" "$key" "$file_id" "$cloud_path" <<'PY'
import json
import sys

path, key, file_id, cloud_path = sys.argv[1:5]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

data[key] = {
    "cloudPath": cloud_path,
    "fileID": file_id,
}

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
}

resolve_bucket_name() {
  if [[ -n "$BUCKET_NAME" ]]; then
    echo "$BUCKET_NAME"
    return
  fi

  local detail_output
  detail_output=$(HOME="$HOME_DIR" XDG_CONFIG_HOME="$XDG_DIR" npm_config_cache="$NPM_CACHE_DIR" \
    npx -y -p @cloudbase/cli tcb env detail -e "$TCB_ENV_ID" --json 2>&1)

  local detail_json
  detail_json=$(extract_last_json "$detail_output")
  if [[ -z "$detail_json" ]]; then
    echo ""
    return
  fi

  python3 - "$detail_json" <<'PY'
import json
import sys

obj = json.loads(sys.argv[1])
bucket = (
    obj.get("data", {})
    .get("resources", {})
    .get("storages", [{}])[0]
    .get("Bucket", "")
)
print(bucket)
PY
}

resolved_bucket="$(resolve_bucket_name)"
if [[ -z "$resolved_bucket" ]]; then
  echo "[error] failed to resolve storage bucket for env: $TCB_ENV_ID"
  exit 1
fi

echo "[info] using bucket: $resolved_bucket"

for i in $(seq "$START_INDEX" "$END_INDEX"); do
  idx="$(format_index "$i")"
  local_file="$LOCAL_DIR/card-$idx.jpg"
  cloud_path="$CLOUD_DIR/card-$idx.jpg"

  if [[ ! -f "$local_file" ]]; then
    echo "[skip] missing: $local_file"
    continue
  fi

  echo "[upload] $local_file -> $cloud_path"
  set +e
  raw_output=$(HOME="$HOME_DIR" XDG_CONFIG_HOME="$XDG_DIR" npm_config_cache="$NPM_CACHE_DIR" \
    npx -y -p @cloudbase/cli tcb storage upload "$local_file" "$cloud_path" -e "$TCB_ENV_ID" --json 2>&1)
  status=$?
  set -e

  if [[ $status -ne 0 ]]; then
    echo "[error] upload failed for $local_file"
    echo "$raw_output"
    exit $status
  fi

  normalized_cloud_path="${cloud_path#/}"
  file_id="cloud://${TCB_ENV_ID}.${resolved_bucket}/${normalized_cloud_path}"

  append_mapping "sentence-$i" "$file_id" "$cloud_path"
  echo "[ok] sentence-$i => $file_id"
done

echo "saved mapping: $OUT_JSON"
cat "$OUT_JSON"
