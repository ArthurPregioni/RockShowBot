import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function smtpRequest(message,configuration={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.PYTHON||'python3',[fileURLToPath(new URL('./smtp.py',import.meta.url))],{env:{...process.env,...configuration},stdio:['pipe','pipe','pipe']});
  let output='',finished=false;
  const timeout=setTimeout(()=>{child.kill('SIGTERM');fail(Object.assign(new Error('O servidor de e-mail demorou para responder.'),{uncertain:!message.validate}));},120000);
  function fail(error){if(finished)return;finished=true;clearTimeout(timeout);reject(error);}
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4096){child.kill('SIGTERM');fail(Object.assign(new Error('Resposta SMTP inválida.'),{uncertain:!message.validate}));}});
  child.stderr.resume();
  child.on('error',()=>fail(Object.assign(new Error('O transporte de e-mail não iniciou.'),{uncertain:false})));
  child.on('close',code=>{
   if(finished)return;
   try{
    const result=JSON.parse(output);
    if(code||!(message.validate?result.authenticated:result.accepted)){
     const description=result.error==='authentication'?'O Gmail/provedor recusou a autenticação. Use a senha de app da conta do remetente.':'O provedor não confirmou a operação de e-mail.';
     throw Object.assign(new Error(description),{uncertain:!!result.uncertain});
    }
    finished=true;clearTimeout(timeout);resolve(result);
   }catch(error){fail(Object.assign(error,{uncertain:error.uncertain??!message.validate}));}
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(message));
 });
}
