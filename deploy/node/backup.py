"""Back up native web SQLite databases without copying open WAL files."""
from pathlib import Path
from contextlib import closing
import os,re,sqlite3,sys,tempfile,tarfile,json,hashlib
from datetime import datetime,timezone


def database_path(environment=os.environ):
    """DATABASE_PATH as the service sees it: the environment, else the private node.env."""
    value=environment.get('DATABASE_PATH')
    if not value:
        config=Path(environment.get('ROCKSHOWBOT_ENV_FILE') or Path(environment.get('ROCKSHOWBOT_CONFIG_DIR') or Path.home()/'.config/rockshowbot')/'node.env')
        match=re.search(r'^DATABASE_PATH=(.*)$',config.read_text(),flags=re.M) if config.is_file() else None
        value=match.group(1).strip() if match else ''
        if len(value)>1 and value[0]==value[-1] and value[0] in '\'"`':value=value[1:-1]
    return Path(value) if value else Path.home()/'.local/share/rockshowbot/web.db'


main=database_path();root=main.parent
if not main.is_file():sys.exit('Banco principal não encontrado em '+str(main)+'; nenhum backup foi criado.')
output=root/'backups';output.mkdir(parents=True,exist_ok=True,mode=0o700)
archive=output/('rockshowbot-web-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.tar.gz')
with tempfile.TemporaryDirectory() as temporary:
 stage=Path(temporary);manifest={'format':'rockshowbot-native-web-backup-v1','files':{}}
 for source in [main,*sorted((root/'users').glob('*.db'))]:
  relative=source.relative_to(root);target=stage/relative;target.parent.mkdir(parents=True,exist_ok=True)
  with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as current,closing(sqlite3.connect(target)) as copy:current.backup(copy)
  target.chmod(0o600);manifest['files'][relative.as_posix()]=hashlib.sha256(target.read_bytes()).hexdigest()
 (stage/'manifest.json').write_text(json.dumps(manifest,indent=2))
 descriptor=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)
 with os.fdopen(descriptor,'wb') as stream,tarfile.open(fileobj=stream,mode='w:gz') as bundle:
  for relative in [*manifest['files'],'manifest.json']:bundle.add(stage/relative,arcname=relative)
print(archive)
