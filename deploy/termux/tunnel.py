"""Keep the phone reachable through an optional fixed public HTTPS address."""
import os,re,signal,subprocess,sys,threading,queue
from pathlib import Path
from bridge import bridge_settings,publish_origin,configure_origin
config=Path.home()/'.config/rockshowbot/node.env'
settings=bridge_settings(config.parent)
updates=queue.Queue();stopped=threading.Event()

def publisher():
 while not stopped.is_set():
  try:url=updates.get(timeout=1)
  except queue.Empty:continue
  delay=2
  while not stopped.is_set():
   try:
    publish_origin(settings,url)
    print('Fixed public address updated.',flush=True)
    break
   except Exception:
    # Never include request headers, the secret or the SMTP configuration in logs.
    print('Public address update pending; retrying.',flush=True)
    try:url=updates.get(timeout=delay)
    except queue.Empty:pass
    delay=min(delay*2,60)

if settings:threading.Thread(target=publisher,daemon=True).start()
def shutdown(_number,_frame):raise SystemExit(0)
signal.signal(signal.SIGTERM,shutdown)
signal.signal(signal.SIGINT,shutdown)
transport_port=int((config.parent/'transport-port.txt').read_text().strip()) if (config.parent/'transport-port.txt').exists() else 8765
if transport_port not in (8765,8791):raise ValueError('Porta de transporte inválida.')
process=subprocess.Popen(['cloudflared','tunnel','--url','http://127.0.0.1:'+str(transport_port),'--protocol','http2','--no-autoupdate'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
previous=None
try:
 for line in process.stdout:
  print(line,end='',flush=True)
  match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',line)
  if match and match.group()!=previous:
   url=match.group();previous=url
   if configure_origin(config,url,settings):
    subprocess.run(['sv','-w','20','restart',str(Path(os.environ['PREFIX'])/'var/service/rockshowbot-web')],check=True)
   if settings:updates.put(url)
finally:
 stopped.set()
 process.terminate()
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:process.kill();process.wait()
sys.exit(process.wait())
