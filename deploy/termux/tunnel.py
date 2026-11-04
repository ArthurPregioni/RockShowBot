"""Keep a free temporary HTTPS tunnel aligned with the local app origin."""
import os,re,subprocess,sys
from pathlib import Path
config=Path.home()/'.config/rockshowbot/node.env'
process=subprocess.Popen(['cloudflared','tunnel','--url','http://127.0.0.1:8765','--protocol','http2','--no-autoupdate'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
try:
 for line in process.stdout:
  print(line,end='',flush=True)
  match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',line)
  if match:
   url=match.group();text=config.read_text()
   updated=re.sub(r'^ROCKSHOWBOT_SITE_ORIGIN=.*$',f'ROCKSHOWBOT_SITE_ORIGIN={url}',text,flags=re.M)
   if updated!=text:
    temporary=config.with_suffix('.tmp');temporary.write_text(updated);temporary.chmod(0o600);temporary.replace(config)
    (config.parent/'public-url.txt').write_text(url+'\n')
    subprocess.run(['sv','-w','20','restart',str(Path(os.environ['PREFIX'])/'var/service/rockshowbot-web')],check=True)
finally:
 process.terminate()
sys.exit(process.wait())
