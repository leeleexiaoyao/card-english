#!/usr/bin/env python3

import argparse
import csv
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


NUMERIC_FIELDS = {"collins", "oxford", "bnc", "frq"}


def run_tcb(command_payload, env_id, json_output=True):
    env = os.environ.copy()
    env.setdefault("HOME", "/tmp/codex-home")
    env.setdefault("XDG_CONFIG_HOME", "/tmp/codex-home/.config")
    env.setdefault("npm_config_cache", "/tmp/npmcache")
    env.setdefault("LOG_DIRNAME", "/tmp/cloudbase-framework/logs")
    env.setdefault("CLOUDBASE_LOG_DIR", "/tmp/cloudbase-framework/logs")
    Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
    Path(env["XDG_CONFIG_HOME"]).mkdir(parents=True, exist_ok=True)
    Path(env["npm_config_cache"]).mkdir(parents=True, exist_ok=True)
    Path(env["LOG_DIRNAME"]).mkdir(parents=True, exist_ok=True)

    cmd = [
        "npx",
        "-y",
        "-p",
        "@cloudbase/cli",
        "tcb",
        "db",
        "nosql",
        "execute",
        "-e",
        env_id,
    ]
    if json_output:
        cmd.append("--json")
    cmd.extend(["--command", json.dumps(command_payload, ensure_ascii=False, separators=(",", ":"))])

    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "tcb command failed")

    if not json_output:
        return result.stdout

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.startswith("{") and line.endswith("}"):
            return json.loads(line)
    raise RuntimeError(f"unable to parse tcb json output: {result.stdout}")


def make_command(table_name, command_type, command):
    return [{
        "TableName": table_name,
        "CommandType": command_type,
        "Command": json.dumps(command, ensure_ascii=False, separators=(",", ":")),
    }]


def normalize_row(row):
    doc = {}
    for key, value in row.items():
        if key is None:
            continue
        text = value if value is not None else ""
        if key in NUMERIC_FIELDS:
            text = str(text).strip()
            if not text:
                doc[key] = 0
            else:
                try:
                    doc[key] = int(float(text))
                except ValueError:
                    doc[key] = 0
            continue
        doc[key] = str(text)
    if "word" in doc:
        doc["word"] = doc["word"].strip()
    return doc


def backup_existing(collection, env_id, output_path):
    payload = make_command(
        collection,
        "QUERY",
        {
            "find": collection,
            "filter": {},
            "limit": 2000,
        },
    )
    result = run_tcb(payload, env_id)
    docs = result.get("data", {}).get("results", [[]])[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(docs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(docs)


def delete_all(collection, env_id):
    payload = make_command(
        collection,
        "DELETE",
        {
            "delete": collection,
            "deletes": [{"q": {}, "limit": 0}],
        },
    )
    run_tcb(payload, env_id)


def count_docs(collection, env_id):
    payload = make_command(
        collection,
        "COMMAND",
        {
            "count": collection,
            "query": {},
        },
    )
    result = run_tcb(payload, env_id)
    raw = result.get("data", {}).get("results", [[{}]])[0][0].get("n", {})
    if isinstance(raw, dict):
        if "$numberInt" in raw:
            return int(raw["$numberInt"])
        if "$numberLong" in raw:
            return int(raw["$numberLong"])
    return int(raw or 0)


def insert_batch(collection, env_id, docs):
    payload = make_command(
        collection,
        "INSERT",
        {
            "insert": collection,
            "documents": docs,
            "ordered": False,
        },
    )
    run_tcb(payload, env_id)


def iter_batches(csv_path, batch_size):
    batch = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            batch.append(normalize_row(row))
            if len(batch) >= batch_size:
                yield batch
                batch = []
    if batch:
        yield batch


def main():
    parser = argparse.ArgumentParser(description="Import ecdict CSV into CloudBase collection")
    parser.add_argument("--env-id", default="cloud1-4gsbdd828457096e")
    parser.add_argument("--collection", default="words")
    parser.add_argument(
        "--csv",
        default="/Users/zb/Documents/小程序/vibe coding/卡片英语学习/cloud-data/words/ecdict.csv",
    )
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise SystemExit(f"csv not found: {csv_path}")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = Path(
        f"/Users/zb/Documents/小程序/vibe coding/卡片英语学习/cloud-data/words/{args.collection}.backup.{timestamp}.json"
    )

    print(f"[info] backing up current collection to {backup_path}")
    backed_up = backup_existing(args.collection, args.env_id, backup_path)
    print(f"[info] backup docs: {backed_up}")

    print(f"[info] deleting existing docs from {args.collection}")
    delete_all(args.collection, args.env_id)

    inserted = 0
    for index, batch in enumerate(iter_batches(csv_path, args.batch_size), start=1):
        insert_batch(args.collection, args.env_id, batch)
        inserted += len(batch)
        if index == 1 or index % 20 == 0:
            print(f"[progress] batches={index} inserted={inserted}")
            sys.stdout.flush()

    remote_count = count_docs(args.collection, args.env_id)
    print(f"[done] local inserted={inserted} remote count={remote_count}")
    if remote_count != inserted:
        raise SystemExit(f"count mismatch: inserted={inserted}, remote={remote_count}")


if __name__ == "__main__":
    main()
