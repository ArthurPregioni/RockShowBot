import {COUNTRY_NAMES} from './bot-core.ts';
export const SOUTH_AMERICA = ['BR','AR','BO','CL','CO','EC','GY','PY','PE','SR','UY','VE'];
export type Preferences = {email:string;notifications:boolean;countries:string[]};
export function parsePreferences(body:Record<string,unknown>):Preferences {
  const email=typeof body.email==='string'?body.email.trim():'';
  if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))throw new Error('Informe um e-mail válido.');
  if(!Array.isArray(body.countries))throw new Error('Escolha os países para acompanhar.');
  const countries=[...new Set(body.countries.map(value=>String(value).toUpperCase()))];
  if(!countries.length||countries.length>30||countries.some(code=>!/^[A-Z]{2}$/.test(code)))throw new Error('Escolha entre 1 e 30 países válidos.');
  const notifications=body.notifications===true;
  if(notifications&&!email)throw new Error('Informe seu e-mail para ativar alertas.');
  return {email,notifications,countries};
}
export function confirmationMessage(id:string,preferences:Preferences,website:string){
  const countries=preferences.countries.map(code=>`${COUNTRY_NAMES[code]||code} (${code})`).join(', ');
  return {to:preferences.email,subject:`RockShowBot — preferências salvas [${id}]`,body:[
    'Suas preferências do RockShowBot foram salvas.',
    '',`Países acompanhados: ${countries}.`,`Alertas de shows: ${preferences.notifications?'ativados':'desativados'}.`,
    `E-mail de alertas: ${preferences.email}.`,
    'As buscas de shows estão programadas para 09h e 21h, no horário de Brasília.',
    'O radar procura shows futuros já marcados e mantém possíveis turnês e rumores separados.',
    '',`Consultar ou alterar preferências: ${website}`,`ID de confirmação: ${id}`,
  ].join('\n')};
}
