import {database,UserError} from '../../server/database.ts';
import {migrationTables,migrationDestination,migrationFreezePlan} from '../../core/migration.ts';
export async function freezeCloud(destination:unknown){
 let target:string;
 try{target=migrationDestination(destination);}catch(error){throw new UserError((error as Error).message);}
 const db=database();
 const result=await db.batch(migrationFreezePlan(target).map(command=>command.values.length?db.prepare(command.sql).bind(...command.values):db.prepare(command.sql)));
 const schedule=(result.at(-1)?.results[0] as {schedule?:string}|undefined)?.schedule;
 if(schedule!=='migrated:'+target)throw new UserError('Há um envio reservado ou de resultado incerto. Concilie o histórico antes da migração.',409);
 return {frozen:true,destination:target,format:'rockshowbot-web-sqlite-v1',exportedAt:new Date().toISOString(),tables:Object.fromEntries(migrationTables.map((table,index)=>[table,result[index].results]))};
}
