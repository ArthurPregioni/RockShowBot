import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {passwordHash} from './session.mjs';
const config=process.env.ROCKSHOWBOT_CONFIG_DIR||path.join(os.homedir(),'.config/rockshowbot');
mkdirSync(config,{recursive:true,mode:0o700});
const env=path.join(config,'node.env');
if(existsSync(env)){console.log('Configuração existente preservada.');process.exit(0);}
const password=randomBytes(24).toString('base64url');
writeFileSync(env,`APP_USER=arthur\nAPP_PASSWORD_HASH=${await passwordHash(password)}\nADMIN_NAME=Arthur\nHOST=127.0.0.1\nPORT=8765\nROCKSHOWBOT_SITE_ORIGIN=http://127.0.0.1:8765\nROCKSHOWBOT_SCHEDULER=false\nDATABASE_PATH=${path.join(os.homedir(),'.local/share/rockshowbot/web.db')}\nSMTP_HOST=\nSMTP_PORT=587\nSMTP_STARTTLS=true\nSMTP_USERNAME=\nSMTP_PASSWORD=\nSMTP_FROM=\n`,{mode:0o600});
writeFileSync(path.join(config,'login.txt'),`RockShowBot\nUsuário: arthur\nSenha: ${password}\n`,{mode:0o600});
console.log('Configuração e credenciais iniciais gravadas no diretório privado.');
