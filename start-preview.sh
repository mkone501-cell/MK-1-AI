#!/usr/bin/env sh

set -eu

PORT="${PORT:-8000}"

printf '\nMK-1 AI経営本部 Ver.0.1 のプレビューを起動します。\n'
printf 'ブラウザで次の場所を開いてください： http://localhost:%s\n' "$PORT"
printf '終了するときは Ctrl+C を押してください。\n\n'

python3 -m http.server "$PORT" --bind 0.0.0.0
