from pathlib import Path
import getpass, os, tempfile
# Same file the server reads: WHOSPOST_ENV_FILE, default <project>/.env.local (git-ignored).
p = Path(os.path.expanduser(os.environ['WHOSPOST_ENV_FILE'])) if os.environ.get('WHOSPOST_ENV_FILE') else Path(__file__).resolve().parent.parent/'.env.local'
token = getpass.getpass('Apify API token（輸入不顯示）: ').strip()
if not token or any(c.isspace() for c in token) or any(c in token for c in '\"\'`$'):
    raise SystemExit('未儲存：token 格式不符')
p.parent.mkdir(parents=True, exist_ok=True)
lines = p.read_text().splitlines() if p.exists() else []
lines = [l for l in lines if l.split('=',1)[0].strip() not in ('APIFY_TOKEN','export APIFY_TOKEN')]
lines.append('APIFY_TOKEN='+token)
fd, name = tempfile.mkstemp(dir=p.parent, prefix='.apify-setup-')
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as f: f.write('\n'.join(lines)+'\n')
    os.replace(name,p)
finally:
    if os.path.exists(name): os.unlink(name)
print('已儲存 APIFY_TOKEN；沒有顯示內容。')
