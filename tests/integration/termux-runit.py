"""Linux+runit integration QA in a disposable Docker container, without Android access.

Run from the repository root. Only this test's container is removed; the project
and private host data are never mounted. The Android wake-lock command is stubbed.
"""
import os,subprocess,secrets
from pathlib import Path

name='rockshowbot-termux-qa-'+secrets.token_hex(3)
def docker(*args,**kwargs):return subprocess.run(['docker',*args],check=True,**kwargs)
try:
 docker('run','-d','--name',name,'python:3.12-slim','sleep','600',stdout=subprocess.DEVNULL)
 docker('exec',name,'sh','-c','apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends runit >/dev/null',stdout=subprocess.DEVNULL)
 docker('exec',name,'mkdir','-p','/opt/rockshowbot/deploy')
 docker('cp','selfhosted',name+':/opt/rockshowbot/selfhosted')
 docker('cp','deploy/termux',name+':/opt/rockshowbot/deploy/termux')
 code=r'''
import os,sys,time,json,subprocess,urllib.request,base64,signal,sqlite3
from pathlib import Path
prefix=Path('/tmp/termux-usr');(prefix/'bin').mkdir(parents=True);(prefix/'var/run').mkdir(parents=True)
for name,target in [('sh','/bin/sh'),('sv','/usr/bin/sv'),('svlogd','/usr/bin/svlogd')]:
 (prefix/'bin'/name).symlink_to(target)
(prefix/'bin/pkg').write_text('#!/bin/sh\nexit 0\n')
daemon=prefix/'bin/service-daemon'
daemon.write_text('#!/bin/sh\nexec /usr/sbin/start-stop-daemon -S -b -m -p "$PREFIX/var/run/qa.pid" -x /usr/bin/runsvdir -- "$PREFIX/var/service"\n');daemon.chmod(0o700)
wake=prefix/'bin/termux-wake-lock';wake.write_text('#!/bin/sh\nexit 0\n');wake.chmod(0o700)
os.environ['PREFIX']=str(prefix);os.chdir('/opt/rockshowbot')
def command(*args):
 return subprocess.check_output([sys.executable,'deploy/termux/manage.py',*args],text=True)
command('install')
config=Path.home()/'.config/rockshowbot/server.env'
password=[line.split('=',1)[1] for line in config.read_text().splitlines() if line.startswith('APP_PASSWORD=')][0]
url='http://127.0.0.1:8765'
other=prefix/'var/service/another-app';other.mkdir();(other/'run').write_text('#!/bin/sh\nexec sleep 600\n');(other/'run').chmod(0o700)
command('start')
def pid(service):
 return int(subprocess.check_output([str(prefix/'bin/sv'),'status',str(prefix/'var/service'/service)],text=True).split('(pid ')[1].split(')')[0])
other_pid=pid('another-app')
authorization='Basic '+base64.b64encode(('admin:'+password).encode()).decode()
body=b'name=QA+Persistent+Band'
with urllib.request.urlopen(urllib.request.Request(url+'/artist',data=body,headers={'Authorization':authorization,'Origin':url,'Content-Type':'application/x-www-form-urlencoded'})) as response: assert response.status==200
old_pid=pid('rockshowbot');os.kill(old_pid,signal.SIGKILL)
for _ in range(80):
 try:
  new_pid=pid('rockshowbot')
  with urllib.request.urlopen(url+'/healthz',timeout=.5) as response: okay=json.load(response).get('app')=='RockShowBot'
  if old_pid!=new_pid and okay:break
 except (OSError,ValueError,IndexError):pass
 time.sleep(.1)
else:raise AssertionError('runit did not restart the application')
backup=Path(command('backup').strip());assert backup.is_file()
command('stop');assert pid('another-app')==other_pid
boot=Path.home()/'.termux/boot/50-rockshowbot'
subprocess.run([str(prefix/'bin/sh'),str(boot)],check=True,env={key:value for key,value in os.environ.items() if key!='PREFIX'})
assert (prefix/'var/service/rockshowbot/down').exists()
command('start');subprocess.run([str(prefix/'bin/sh'),str(boot)],check=True,env={key:value for key,value in os.environ.items() if key!='PREFIX'})
command('restore',str(backup));assert (prefix/'var/service/rockshowbot/down').exists()
with sqlite3.connect(Path.home()/'.local/share/rockshowbot/rockshowbot.db') as connection:
 assert connection.execute("SELECT COUNT(*) FROM artists WHERE name='QA Persistent Band'").fetchone()[0]==1
assert pid('another-app')==other_pid
print('Native runit QA OK: install, start, real HTTP login/write, automatic crash restart, persistence, disabled/enabled boot, backup/restore, and other-service preservation. Android wake lock is stubbed; this is Linux QA, not a physical Android test.')
'''
 docker('exec','-i',name,'python','-',input=code,text=True)
finally:
 subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
