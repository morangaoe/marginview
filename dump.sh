#!/usr/bin/env bash

OUTPUT_FILE="marginview_context_full.txt"

python3 - << 'PYTHON_SCRIPT'
import os
import re
from pathlib import Path

ROOT_DIR = Path.cwd()
OUTPUT_FILE = ROOT_DIR / "marginview_context_full.txt"
EXTENSIONS = {'.ts', '.tsx', '.js', '.jsx', '.css', '.sql', '.json', '.env', '.example'}
EXCLUDE_DIRS = {'node_modules', '.git', 'dist', 'build', '.vite', '.next', 'coverage'}

found_files = []
unresolved_imports = []

# 1. Dynamically scan all codebase files
for path in ROOT_DIR.rglob('*'):
    if any(ex in path.parts for ex in EXCLUDE_DIRS):
        continue
    if path.is_file() and (path.suffix in EXTENSIONS or path.name in {'package.json', '.env.example'}):
        rel_path = path.relative_to(ROOT_DIR)
        found_files.append(rel_path)

# Helper to check if local imports exist on disk
def resolve_import(base_file, import_str):
    if not (import_str.startswith('.') or import_str.startswith('@/')):
        return True # External package
    
    base_dir = base_file.parent
    
    if import_str.startswith('@/'):
        if 'apps/web' in base_file.parts:
            target_base = ROOT_DIR / 'apps/web/src' / import_str[2:]
        elif 'apps/api' in base_file.parts:
            target_base = ROOT_DIR / 'apps/api/src' / import_str[2:]
        else:
            target_base = ROOT_DIR / import_str[2:]
    else:
        target_base = (base_dir / import_str).resolve()

    candidates = [
        target_base,
        Path(str(target_base) + '.ts'),
        Path(str(target_base) + '.tsx'),
        Path(str(target_base) + '.js'),
        Path(str(target_base) + '.jsx'),
        Path(str(target_base) + '.json'),
        target_base / 'index.ts',
        target_base / 'index.tsx',
        target_base / 'index.js',
    ]
    
    for cand in candidates:
        if cand.exists() and cand.is_file():
            return True
            
    return False

# 2. Generate unified context file
with open(OUTPUT_FILE, 'w', encoding='utf-8') as out:
    out.write("=== MARGINVIEW COMPLETE CONTEXT DUMP ===\n")
    out.write(f"Total Files Scanned: {len(found_files)}\n\n")
    
    for rel_path in sorted(found_files):
        full_path = ROOT_DIR / rel_path
        out.write(f"=== {rel_path} ===\n")
        
        try:
            content = full_path.read_text(encoding='utf-8', errors='replace')
            out.write(content)
            out.write("\n\n")
            
            # Extract TS/JS imports and check resolution
            if rel_path.suffix in {'.ts', '.tsx', '.js', '.jsx'}:
                imports = re.findall(r'''(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)''', content)
                for imp_tuple in imports:
                    imp_str = imp_tuple[0] or imp_tuple[1]
                    if imp_str and (imp_str.startswith('.') or imp_str.startswith('@/')):
                        if not resolve_import(full_path, imp_str):
                            unresolved_imports.append((str(rel_path), imp_str))
                            
        except Exception as e:
            out.write(f"(Error reading file: {e})\n\n")

    # 3. Append Unresolved Imports Footer
    out.write("=== UNRESOLVED IMPORTS ===\n")
    if unresolved_imports:
        for source, target in sorted(set(unresolved_imports)):
            out.write(f"- File: {source} -> Missing Import: '{target}'\n")
    else:
        out.write("None! All local relative and alias imports successfully resolved on disk.\n")

print(f"Dump complete: {OUTPUT_FILE}")
print(f"Total files included: {len(found_files)}")
print(f"Unresolved local imports found: {len(set(unresolved_imports))}")

PYTHON_SCRIPT
