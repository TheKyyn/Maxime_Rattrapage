#!/usr/bin/env python3
"""Assemble les livrables sans dépendances locales ni volumes Docker."""
import hashlib
import sys
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT.parent / 'THEOPHILOS_Maxime_UE03.zip'
FILES = ['README.md', 'Dockerfile', '.dockerignore', '.gitignore',
         'eslint.config.js', 'package.json', 'package-lock.json',
         'compose.yaml', 'git.txt', 'rapport.pdf', 'demo.mp4']
DIRECTORIES = ['.github', 'ci', 'config', 'data', 'docs', 'evidence', 'scripts', 'src', 'test']
paths = [ROOT / name for name in FILES]
for name in DIRECTORIES:
    paths.extend(p for p in (ROOT / name).rglob('*')
                 if p.is_file() and p.name != '.DS_Store' and '__pycache__' not in p.parts)
for path in paths:
    if not path.is_file():
        sys.exit(f'ZIP non créé : fichier manquant {path.relative_to(ROOT)}. '
                 'Ajouter les livrables manquants puis relancer cette commande.')
with zipfile.ZipFile(DEST, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(paths):
        archive.write(path, path.relative_to(ROOT))
with zipfile.ZipFile(DEST) as archive:
    assert archive.testzip() is None
    assert archive.read('git.txt').decode().strip() == 'https://github.com/TheKyyn/Maxime_Rattrapage'
digest = hashlib.sha256(DEST.read_bytes()).hexdigest()
DEST.with_suffix('.zip.sha256').write_text(f'{digest}  {DEST.name}\n')
print(f'{DEST.name} : {len(paths)} fichiers, {DEST.stat().st_size:,} octets, SHA-256 {digest}')
