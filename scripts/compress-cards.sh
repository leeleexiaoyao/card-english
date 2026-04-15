#!/usr/bin/env bash
set -euo pipefail

START_INDEX="${1:-1}"
END_INDEX="${2:-9}"
SRC_DIR="${3:-miniprogram/images/cards}"
OUT_DIR="${4:-miniprogram/images/cards-upload}"
MAX_SIZE="${MAX_SIZE:-768}"
QUALITY="${QUALITY:-65}"

mkdir -p "$OUT_DIR"

format_index() {
  printf "%04d" "$1"
}

orig_total=0
new_total=0

for i in $(seq "$START_INDEX" "$END_INDEX"); do
  idx="$(format_index "$i")"
  src="$SRC_DIR/card-$idx.jpg"
  dst="$OUT_DIR/card-$idx.jpg"

  if [[ ! -f "$src" ]]; then
    echo "[skip] missing: $src"
    continue
  fi

  sips -Z "$MAX_SIZE" -s format jpeg -s formatOptions "$QUALITY" "$src" --out "$dst" >/dev/null

  orig_size=$(stat -f%z "$src")
  new_size=$(stat -f%z "$dst")
  orig_total=$((orig_total + orig_size))
  new_total=$((new_total + new_size))

  printf "[ok] %s -> %s (%d -> %d bytes)\n" "$src" "$dst" "$orig_size" "$new_size"
done

if [[ "$orig_total" -gt 0 ]]; then
  python3 - <<PY
orig = $orig_total
new = $new_total
print(f"total: {orig} -> {new} bytes, ratio={new/orig:.3f}")
PY
else
  echo "no files processed"
fi
