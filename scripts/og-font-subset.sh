#!/bin/sh
# Rebuilds the preview-card fonts in worker/og/ from the Noto Sans TC OTFs (notofonts/noto-cjk,
# Sans/SubsetOTF/TC). Keeps Big5 level-1 hanzi and symbols (about 5,900 characters), ASCII and the card's own
# fixed text (e.g. the ・ separator, which Big5 lacks), so any AI conclusion renders with few gaps while the
# Worker stays small. Needs fontTools: pip install fonttools
# Usage: scripts/og-font-subset.sh <dir with NotoSansTC-Regular.otf and NotoSansTC-Bold.otf>
set -eu
src=$1; out=$(dirname "$0")/../worker/og; chars=$(mktemp)
python3 - "$chars" <<'PY'
import sys
out={chr(c) for c in range(0x20,0x7f)}|set('・｜…「」『』—')
for lead in range(0xA1,0xC7):
  for trail in [*range(0x40,0x7F),*range(0xA1,0xFF)]:
    if lead==0xC6 and trail>0x7E: break
    try: out.add(bytes([lead,trail]).decode('big5'))
    except UnicodeDecodeError: pass
open(sys.argv[1],'w').write(''.join(sorted(out)))
PY
for w in Regular Bold; do
  pyftsubset "$src/NotoSansTC-$w.otf" --text-file="$chars" --layout-features='*' --no-hinting --output-file="$out/NotoSansTC-$w-subset.otf"
done
rm -f "$chars"
