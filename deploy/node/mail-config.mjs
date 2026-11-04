import {smtpRequest} from './smtp-client.mjs';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mailHTML(notice=''){
 const configured=!!process.env.SMTP_HOST;
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>E-mail · RockShowBot</title><style>body{max-width:650px;margin:40px auto;padding:24px;background:#101114;color:#f2eff4;font:16px system-ui;line-height:1.6}a{color:#ff8295}input,select{display:block;width:90%;background:#1b202a;color:white;border:1px solid #566070;border-radius:8px;padding:12px;margin:8px 0 20px}button{border:0;border-radius:8px;background:#ff687e;color:#301521;padding:12px 20px}p{color:#a4acb9}</style><a href="/account">← Conta</a><h1>Remetente do bot</h1><p>${configured?'Um provedor de envio está configurado.':'O envio está aguardando a configuração do provedor.'} ${process.env.ROCKSHOWBOT_DELIVERY_ENABLED==='false'?'Os disparos estão pausados durante a migração. A credencial será validada sem enviar e-mail.':''} Todas as contas usam este remetente; cada conta escolhe o destinatário de seus alertas.</p>${notice?`<p role="status">${esc(notice)}</p>`:''}<form method="post"><label>Servidor SMTP<input name="host" value="${esc(process.env.SMTP_HOST||'smtp.gmail.com')}" required autocomplete="off"></label><label>Porta<input name="port" type="number" min="1" max="65535" value="${esc(process.env.SMTP_PORT||'587')}" required></label><label>Usuário/e-mail do remetente<input name="username" value="${esc(process.env.SMTP_USERNAME||'')}" required autocomplete="off"></label><label>Senha de app ou credencial SMTP<input name="password" type="password" autocomplete="new-password" placeholder="${process.env.SMTP_PASSWORD?'Preenchida; deixe vazio para manter':'Cole a credencial do provedor aqui'}"></label><label>Remetente exibido<input name="from" value="${esc(process.env.SMTP_FROM||'')}" placeholder="RockShowBot &lt;email-do-bot@provedor.com&gt;" required></label><button>Salvar configuração</button></form><p>Use uma credencial própria para aplicativos. Ela fica no arquivo privado do servidor e não é exibida novamente nesta página.</p></html>`;
}
export async function saveMailConfig(form){
 const config=process.env.ROCKSHOWBOT_ENV_FILE;if(!config)throw new Error('Use um arquivo privado de configuração para salvar SMTP.');
 const host=form.get('host')||'',port=Number(form.get('port'));
 if(!/^[a-zA-Z0-9.-]+$/.test(host)||!Number.isInteger(port)||port<1||port>65535)throw new Error('Servidor ou porta inválidos.');
 const values={SMTP_HOST:host,SMTP_PORT:String(port),SMTP_USERNAME:form.get('username')||'',SMTP_PASSWORD:form.get('password')||process.env.SMTP_PASSWORD||'',SMTP_FROM:form.get('from')||'',SMTP_STARTTLS:'true'};
 if(host.toLowerCase()==='smtp.gmail.com')values.SMTP_PASSWORD=values.SMTP_PASSWORD.replace(/\s+/g,'');
 if(!values.SMTP_PASSWORD)throw new Error('Informe a credencial SMTP.');
 if(Object.values(values).some(v=>/[\r\n]/.test(v)))throw new Error('Valores inválidos.');
 await smtpRequest({validate:true},values);
 let content=readFileSync(config,'utf8');
 for(const [key,value]of Object.entries(values)){
  const pattern=new RegExp(`^${key}=.*$`,'m'),line=key+'='+JSON.stringify(value);
  content=pattern.test(content)?content.replace(pattern,()=>line):content+'\n'+line+'\n';
 }
 const temporary=config+'.smtp-new';writeFileSync(temporary,content,{mode:0o600,flag:'wx'});renameSync(temporary,config);Object.assign(process.env,values);
}
