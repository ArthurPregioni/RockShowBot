import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync,chmodSync} from 'node:fs';
import path from 'node:path';

export class SQLiteBinding {
  constructor(filename){
    if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
    this.connection=new DatabaseSync(filename);
    if(filename!==':memory:')chmodSync(filename,0o600);
    this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=20000;');
  }
  prepare(sql){return new Statement(this.connection,sql);}
  async batch(statements){
    this.connection.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(s=>s.execute());this.connection.exec('COMMIT');return results;}
    catch(error){this.connection.exec('ROLLBACK');throw error;}
  }
  migrate(directory){
    this.connection.exec('CREATE TABLE IF NOT EXISTS node_migrations(name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
      if(this.connection.prepare('SELECT 1 FROM node_migrations WHERE name=?').get(name))continue;
      this.connection.exec('BEGIN IMMEDIATE');
      try{
        this.connection.exec(readFileSync(path.join(directory,name),'utf8'));
        this.connection.prepare('INSERT INTO node_migrations(name) VALUES(?)').run(name);
        this.connection.exec('COMMIT');
      }catch(error){this.connection.exec('ROLLBACK');throw error;}
    }
  }
}
class Statement {
  constructor(connection,sql,values=[]){this.connection=connection;this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.connection,this.sql,values.map(v=>v===undefined?null:v));}
  async first(column){const row=this.connection.prepare(this.sql).get(...this.values);return row?(column?row[column]:{...row}):null;}
  async all(){return {success:true,results:this.connection.prepare(this.sql).all(...this.values).map(r=>({...r})),meta:{}};}
  execute(){const result=this.connection.prepare(this.sql).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
  async run(){return this.execute();}
}
