import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {csmDonationSplit,allocatedDonorTransactions} from '../src/donation-splits';
const databases:DatabaseSync[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function setup(){
 const db=new DatabaseSync(':memory:');databases.push(db);for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
 db.exec(`INSERT INTO paypal_transactions(id,transaction_id,event_code,transaction_date,type,status,direction,currency,gross,fee,net,counterparty_name,product_detected,raw_json,first_seen_at,last_seen_at) VALUES('PAYPAL:T0006','PAYPAL','T0006','2026-09-17','payment','Completed','received','USD',300,-9,291,'Transfer agent','HopeSojourns','{}','now','now')`);
 class Stmt{values:any[]=[];constructor(public sql:string){}bind(...v:any[]){this.values=v;return this;}async first(){return db.prepare(this.sql).get(...this.values)||null;}async all(){return {results:db.prepare(this.sql).all(...this.values)};}async run(){return {meta:{changes:Number(db.prepare(this.sql).run(...this.values).changes)}};}}
 const env={DB:{prepare:(s:string)=>new Stmt(s),batch:async(ss:Stmt[])=>{db.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},CSM_DISTRIBUTION_SECRET:'test-secret',HOPE_ADMIN:{fetch:vi.fn()}} as unknown as Env;
 return {db,env};
}
const rows=[{firstName:'Alice',lastName:'Example',email:'alice@example.test',date:'2025-12-31',amountCents:10000,note:''},{firstName:'Bob',lastName:'Example',email:'bob@example.test',date:'2026-09-01',amountCents:20000,note:''}];
const req=(allocations=rows,revision=0)=>new Request('http://localhost/donation-splits/PAYPAL%3AT0006',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,parentVersion:'300:2026-09-17:received',allocations})});
function deliver(db:DatabaseSync){db.exec(`INSERT INTO csm_master_donors(id,identity_key,display_name,created_at,updated_at) VALUES('donor','donor','Transfer agent','now','now')`);db.prepare(`INSERT INTO csm_distribution_outbox(id,message_id,idempotency_key,source_record_id,source_transaction_id,source_event_code,source_revision,destination,direction,display_name,master_donor_id,payload_json,status,created_at,updated_at) VALUES('out','msg','key','PAYPAL:T0006','PAYPAL','T0006',1,'HopeSojourns','received','Transfer agent','donor',?,'approved','now','now')`).run(JSON.stringify({donorSplitRevision:1,donorAllocations:rows}));}
it('preserves one deposit and replaces donor statement details with allocations, including original gift year',async()=>{
 const {env,db}=setup();expect((await csmDonationSplit(req(),env,'PAYPAL:T0006','admin')).status).toBe(200);
 const report=await allocatedDonorTransactions(env,[{id:'PAYPAL:T0006',transactionDate:'2026-09-17',gross:300,counterpartyName:'Transfer agent'}],'2025');expect(report).toHaveLength(1);expect(report[0]).toMatchObject({gross:100,counterpartyName:'Alice Example'});
 expect(db.prepare('SELECT COUNT(*) AS n,SUM(gross) AS gross,SUM(net) AS net FROM paypal_transactions').get()).toEqual({n:1,gross:300,net:291});
 await expect(csmDonationSplit(req(rows,0),env,'PAYPAL:T0006','admin')).rejects.toMatchObject({status:409});
 await csmDonationSplit(req([],1),env,'PAYPAL:T0006','admin');expect(db.prepare('SELECT COUNT(*) AS n FROM donation_split_history').get()?.n).toBe(2);
});
it('delegates edits after transfer to HS and refuses stale local edits',async()=>{
 const {env,db}=setup();await csmDonationSplit(req(),env,'PAYPAL:T0006','admin');deliver(db);
 expect(()=>db.exec("UPDATE donation_splits SET allocations_json='[]'")).toThrow();
 const remote={parent:{updated_at:'now'},allocations:rows,revision:3};const fetch=vi.mocked(env.HOPE_ADMIN.fetch);fetch.mockResolvedValueOnce(Response.json({snapshots:{'PAYPAL:T0006':remote}})).mockResolvedValueOnce(Response.json({success:true}));
 expect((await csmDonationSplit(req(rows,3),env,'PAYPAL:T0006','admin')).status).toBe(200);expect(fetch).toHaveBeenCalledTimes(2);
 const options=fetch.mock.calls[1]![1]!;expect(JSON.parse(String(options.body))).toMatchObject({operation:'save',revision:3,sourceIds:['PAYPAL:T0006']});
});
it('fails closed for giving statements when authoritative HS allocations are unavailable',async()=>{
 const {env,db}=setup();await csmDonationSplit(req(),env,'PAYPAL:T0006','admin');deliver(db);vi.mocked(env.HOPE_ADMIN.fetch).mockResolvedValue(new Response('unavailable',{status:503}));
 await expect(allocatedDonorTransactions(env,[{id:'PAYPAL:T0006',transactionDate:'2026-09-17',gross:300}],'2026')).rejects.toMatchObject({status:503});
});
it('uses HS allocations even when the approval callback has not reached CSM',async()=>{
 const {env,db}=setup();await csmDonationSplit(req(),env,'PAYPAL:T0006','admin');deliver(db);db.exec("UPDATE csm_distribution_outbox SET status='pending'");
 vi.mocked(env.HOPE_ADMIN.fetch).mockResolvedValue(Response.json({snapshots:{'PAYPAL:T0006':{allocations:[{...rows[0],date:'2026-09-16',amountCents:15000},{...rows[1],amountCents:15000}]}}}));
 const report=await allocatedDonorTransactions(env,[{id:'PAYPAL:T0006',transactionDate:'2026-09-17',gross:300}],'2026');expect(report).toHaveLength(2);expect(report.map(t=>t.gross)).toEqual([150,150]);
});
