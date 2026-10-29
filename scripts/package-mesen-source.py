#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Package corresponding native source without rebuilding unchanged executable code."""
import argparse, gzip, hashlib, json, pathlib, subprocess, tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
source = pathlib.Path(args.source).resolve()
pin = '4c4e069f16a8ad6ed79e046046c56d51558c7daf'
if (source / '.git').exists():
    if subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() != pin:
        raise SystemExit('Unexpected MesenCE revision')
notice = '// RetroRoom browser modifications, documented 2026-10-29. See retro-room/native/CHANGES.md in the corresponding source archive.\n'
modified = ['Libretro/libretro.cpp', 'Core/Shared/Video/VideoDecoder.cpp', 'Core/Shared/Video/VideoRenderer.cpp']
for file in modified:
    target = source / file
    text = target.read_text()
    if not text.startswith(notice):
        target.write_text(notice + text)
# All source/header directories consumed by build-mesen.py. Unused desktop UI/platform
# resources (including opaque Satellaview data templates) are not native build inputs.
folders = ['Core', 'Utilities', 'SevenZip', 'Lua', 'Libretro']
archive = root / 'web/assets/mesen-source.tar.gz'
def stable(info):
    info.uid = info.gid = info.mtime = 0
    info.uname = info.gname = ''
    info.mode = 0o644
    return info
with archive.open('wb') as output:
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0, compresslevel=9) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for folder in folders:
                for file in sorted((source / folder).rglob('*')):
                    if file.is_file():
                        tar.add(file, arcname=pathlib.Path('mesen-src') / file.relative_to(source), recursive=False, filter=stable)
            for file in ['LICENSE', 'README.md', 'Makefile.libretro']:
                tar.add(source / file, arcname='mesen-src/' + file, filter=stable)
            for file in ['native/mesen-web.cpp', 'native/MESEN-LICENSE.txt', 'native/README.md', 'native/CHANGES.md',
                         'scripts/build-mesen.py', 'scripts/package-mesen-source.py', 'web/THIRD-PARTY-NOTICES.txt', 'LICENSING.md']:
                tar.add(root / file, arcname=pathlib.Path('retro-room') / file, filter=stable)

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()
meta = {'engine': 'MesenCE', 'revision': pin, 'toolchain': 'Emscripten 4.0.19', 'bridge': 'retroroom-web-3',
        'wasmSha256': sha(root / 'web/assets/mesen-core.wasm'), 'loaderSha256': sha(root / 'web/assets/mesen-core.mjs'),
        'sourceArchive': archive.name, 'sourceSha256': sha(archive), 'license': 'GPL-3.0-only',
        'upstreamLicense': 'GPL-3.0-or-later', 'licenseSelection': 'GNU GPL version 3 selected for the combined distribution, including xBRZ.',
        'sourceScope': folders, 'modificationsDocumented': '2026-10-29', 'nativeCodeChangedByLicenseAudit': False}
(root / 'web/assets/mesen-build.json').write_text(json.dumps(meta, indent=2) + '\n')
print('Packaged native corresponding source and verified-loader metadata.')
