"""Back up native web SQLite databases without copying open WAL files."""
from pathlib import Path
import os,sqlite3,tempfile,tarfile,json,hashlib
from datetime import datetime,timezone
root=Path(os.environ.get('DATABASE_PATH',str(Path.home()/'.local/share/rockshowbot/web.db'))).parent
output=root/'backups';output.mkdir(parents=True,exist_ok=True,mode=0o700)
archive=output/('rockshowbot-web-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.tar.gz')
with tempfile.TemporaryDirectory() as temporary:
 stage=Path(temporary);manifest={'format':'rockshowbot-native-web-backup-v1','files':{}}
 for source in [root/'web.db',*sorted((root/'users').glob('*.db'))]:
  if not source.exists():continue
  relative=source.relative_to(root);target=stage/relative;target.parent.mkdir(parents=True,exist_ok=True)
  with sqlite3.connect(f'file:{source}?mode=ro',uri=True) as current,sqlite3.connect(target) as backup:current.backup(backup)
  target.chmod(0o600);manifest['files'][str(relative)]=hashlib.sha256(target.read_bytes()).hexdigest()
 (stage/'manifest.json').write_text(json.dumps(manifest,indent=2))
 descriptor=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(descriptor,'wb') as stream,tarfile.open(fileobj=stream,mode='w:gz') as bundle:
  for relative in [*manifest['files'],'manifest.json']:bundle.add(stage/relative,arcname=relative)
print(archive)
