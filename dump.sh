#!/usr/bin/env bash
set -euo pipefail
OUT=marginview_context.txt
: > "$OUT"

ENTRIES="apps/api/src/index.ts apps/web/src/main.tsx"
CONFIGS=".gitignore package.json apps/api/package.json apps/api/tsconfig.json apps/api/.env.example apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/vercel.json apps/api/src/db/schema.sql apps/api/src/db/migrations/002_modules.sql apps/web/src/styles/modules.css"

declare -A SEEN
MISSING=()
queue=($ENTRIES)

while [ ${#queue[@]} -gt 0 ]; do
  f=${queue[0]}; queue=("${queue[@]:1}")
  [ -n "${SEEN[$f]:-}" ] && continue
  SEEN[$f]=1
  dir=$(dirname "$f")
  
  # Extracts both single and double quoted relative imports
  while IFS= read -r spec; do
    [ -z "$spec" ] && continue
    base="$dir/$spec"
    found=""
    for cand in "$base" "$base.ts" "$base.tsx" "$base.css" "$base/index.ts" "$base/index.tsx"; do
      [ -f "$cand" ] && { found="$cand"; break; }
    done
    if [ -n "$found" ]; then 
      queue+=("$found")
    else 
      MISSING+=("$f -> $spec")
    fi
  done < <(grep -oE '["'\'']\.[^"'\''\n]+["'\'']' "$f" 2>/dev/null | sed -E 's/["'\'']//g')
done

FILES=$(printf '%s\n' "${!SEEN[@]}" | sort)
for f in $CONFIGS $FILES; do
  [ -f "$f" ] || continue
  printf '\n\n===== %s =====\n' "$f" >> "$OUT"
  cat "$f" >> "$OUT"
done

printf '\n\n===== UNRESOLVED IMPORTS =====\n' >> "$OUT"
printf '%s\n' "${MISSING[@]:-none}" >> "$OUT"

echo "Files processed: $(printf '%s\n' "${!SEEN[@]}" | wc -l)"
echo "Unresolved imports: ${#MISSING[@]}"
wc -c "$OUT"
