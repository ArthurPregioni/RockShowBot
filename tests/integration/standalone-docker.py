"""Smoke test for an already-built image; creates and removes only its own test container/volume."""
import subprocess,os,secrets,json,time,urllib.request,urllib.error,base64
image=os.environ.get('ROCKSHOWBOT_QA_IMAGE','rockshowbot-local-qa')
name='rockshowbot-qa-'+secrets.token_hex(4)
volume=name+'-data'
environment={**os.environ,'APP_PASSWORD':secrets.token_urlsafe(32)}
def run(*args,**kwargs):return subprocess.check_output(['docker',*args],**kwargs).decode().strip()
def start():
 run('run','-d','--name',name,'--env','APP_PASSWORD','-v',volume+':/var/data','-p','127.0.0.1::10000',image,env=environment)
 port=json.loads(run('inspect',name))[0]['NetworkSettings']['Ports']['10000/tcp'][0]['HostPort']
 return 'http://127.0.0.1:'+port
try:
 origin=start()
 for _ in range(50):
  try:
   with urllib.request.urlopen(origin+'/healthz',timeout=2) as response:assert response.status==200
   break
  except (OSError,urllib.error.URLError):time.sleep(.1)
 else:raise RuntimeError('Health check timed out')
 try:urllib.request.urlopen(origin,timeout=2);raise AssertionError('Anonymous dashboard was accepted')
 except urllib.error.HTTPError as error:assert error.code==401
 auth=base64.b64encode(('admin:'+environment['APP_PASSWORD']).encode()).decode()
 with urllib.request.urlopen(urllib.request.Request(origin,headers={'Authorization':'Basic '+auth}),timeout=3) as response:assert response.status==200
 run('exec',name,'python','-c',"import sqlite3; c=sqlite3.connect('/var/data/rockshowbot.db'); c.execute(\"INSERT INTO artists(name) VALUES('QA Persistence')\"); c.commit()")
 run('rm','-f',name)
 origin=start()
 output=run('exec',name,'python','-c',"import sqlite3; c=sqlite3.connect('/var/data/rockshowbot.db'); print(c.execute(\"SELECT COUNT(*) FROM artists WHERE name='QA Persistence'\").fetchone()[0])")
 assert output=='1',output
 print('Docker QA OK: /healthz, anonymous rejection, authenticated dashboard and persistence after container replacement. No email sent.')
finally:
 subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['docker','volume','rm',volume],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
