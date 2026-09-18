import {AdminError,adminJson,readAdminJson} from './security';
import {validateAllocations,type DonationAllocation} from './donation-allocation';
type Snapshot={parent:{name:string;transaction_date:string;updated_at:string;fee:number;net:number};totalCents:number;revision:number;allocations:DonationAllocation[];history:unknown[]};
export async function hopeSnapshots(env:Env,ids:string[],includePeople=false):Promise<Record<string,Snapshot>>{
 const result:Record<string,Snapshot>={};
 if(ids.length&&!env.CSM_DISTRIBUTION_SECRET)throw new AdminError(503,'HS_UNAVAILABLE','The HS connection is not configured.');
 for(let i=0;i<ids.length;i+=100){
  const response=await env.HOPE_ADMIN.fetch('https://csm.internal/internal/donation-splits',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-CSM-Distribution-Secret':env.CSM_DISTRIBUTION_SECRET||''},body:JSON.stringify({sourceIds:ids.slice(i,i+100),includePeople})});
  if(!response.ok)throw new AdminError(503,'HS_UNAVAILABLE','Hope Sojourns donor details are unavailable. Try again before generating giving statements.');
  const data=await response.json() as {snapshots:Record<string,Snapshot>};Object.assign(result,data.snapshots);
 }
 return result;
}
export async function csmDonationSplit(request:Request,env:Env,id:string,actor:string){
 const parent=await env.DB.prepare(`SELECT id,counterparty_name AS name,transaction_date,gross,fee,net,direction,status,currency,event_code,COALESCE(product_override,product_detected) AS program FROM paypal_transactions WHERE id=?`).bind(id).first<{id:string;name:string;transaction_date:string;gross:number;fee:number;net:number;direction:string;status:string;currency:string;event_code:string;program:string}>();
 if(!parent)throw new AdminError(404,'NOT_FOUND','Payment not found.');
 if(parent.direction!=='received'||parent.status!=='Completed'||parent.currency!=='USD'||parent.gross<=0||!parent.event_code.startsWith('T00')||!['ChristianSteps','HopeSojourns'].includes(parent.program))throw new AdminError(422,'NOT_DONATION','Select a completed CSM or HS donation.');
 const delivery=await env.DB.prepare('SELECT status,destination FROM csm_distribution_outbox WHERE source_record_id=? ORDER BY source_revision DESC LIMIT 1').bind(id).first<{status:string;destination:string}>();
 if(delivery?.destination==='HopeSojourns'){
  const remote=(await hopeSnapshots(env,[id],true))[id];
  if(remote){
   if(request.method==='GET')return adminJson(remote);
   const response=await env.HOPE_ADMIN.fetch('https://csm.internal/internal/donation-splits',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-CSM-Distribution-Secret':env.CSM_DISTRIBUTION_SECRET||''},body:JSON.stringify({...await readAdminJson(request),sourceIds:[id],operation:'save',actor})});
   return adminJson(await response.json(),response.status);
  }
  throw new AdminError(409,'AWAITING_APPROVAL','This payment is in the HS inbox. Approve it there before editing donor allocations.');
 }
 const split=await env.DB.prepare('SELECT revision,allocations_json FROM donation_splits WHERE entry_id=?').bind(id).first<{revision:number;allocations_json:string}>();
 const revision=split?.revision||0,version=`${parent.gross}:${parent.transaction_date}:${parent.direction}`;
 if(request.method==='GET'){
  const history=await env.DB.prepare('SELECT revision,allocations_json,updated_at,actor FROM donation_split_history WHERE entry_id=? ORDER BY revision DESC LIMIT 50').bind(id).all();
  const donors=await env.DB.prepare(`SELECT DISTINCT json_extract(value,'$.firstName') AS first_name,json_extract(value,'$.lastName') AS last_name,json_extract(value,'$.email') AS email FROM donation_splits,json_each(allocations_json)`).all();
  return adminJson({parent:{...parent,updated_at:version},totalCents:Math.round(parent.gross*100),revision,allocations:JSON.parse(split?.allocations_json||'[]'),history:history.results,knownDonors:donors.results});
 }
 const body=await readAdminJson(request);
 if(body.revision!==revision||body.parentVersion!==version)throw new AdminError(409,'STALE_SPLIT','The payment changed. Close and reopen the split.');
 let rows:DonationAllocation[];try{rows=validateAllocations(body.allocations,Math.round(parent.gross*100));}catch(e){throw new AdminError(422,'INVALID_SPLIT',(e as Error).message);}
 rows=rows.map(({personId,...row})=>row);
 try{await env.DB.batch([
  env.DB.prepare(`INSERT INTO donation_split_guards(value) SELECT 0 WHERE COALESCE((SELECT revision FROM donation_splits WHERE entry_id=?),0)!=? OR NOT EXISTS(SELECT 1 FROM paypal_transactions WHERE id=? AND gross=? AND transaction_date=? AND direction='received')`).bind(id,revision,id,parent.gross,parent.transaction_date),
  env.DB.prepare(`INSERT INTO donation_splits(entry_id,revision,allocations_json,updated_at,actor) VALUES(?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET revision=excluded.revision,allocations_json=excluded.allocations_json,updated_at=excluded.updated_at,actor=excluded.actor`).bind(id,revision+1,JSON.stringify(rows),new Date().toISOString(),actor),
 ]);}catch{throw new AdminError(409,'SPLIT_CHANGED','The donation changed or was sent to HS. Close and reopen it.');}
 return adminJson({success:true});
}
export async function allocatedDonorTransactions(env:Env,transactions:Record<string,unknown>[],year:string){
 const saved=await env.DB.prepare('SELECT entry_id,allocations_json FROM donation_splits').all<{entry_id:string;allocations_json:string}>();
 const allocations=new Map(saved.results.map(r=>[r.entry_id,JSON.parse(r.allocations_json) as DonationAllocation[]]));
 const deliveries=await env.DB.prepare("SELECT source_record_id,status FROM csm_distribution_outbox WHERE destination='HopeSojourns'").all<{source_record_id:string;status:string}>();
 const transactionIds=new Set(transactions.map(t=>String(t.id)));
 const ids=[...new Set(deliveries.results.map(r=>r.source_record_id).filter(id=>transactionIds.has(id)))];
 const remote=await hopeSnapshots(env,ids);
 for(const id of ids){
  if(remote[id])allocations.set(id,remote[id]!.allocations);
  else if(deliveries.results.some(r=>r.source_record_id===id&&r.status==='approved'))throw new AdminError(503,'HS_DONATION_MISSING','A transferred HS donation is unavailable. Resolve it before generating statements.');
 }
 return transactions.flatMap(t=>{
  const rows=allocations.get(String(t.id));if(!rows?.length)return String(t.transactionDate).startsWith(year)?[t]:[];
  return rows.filter(a=>a.date.startsWith(year)).map((a,index)=>({...t,id:`${t.id}:donor:${index}`,donorKey:a.personId?'hs:'+a.personId:undefined,transactionDate:a.date,counterpartyName:a.firstName+' '+a.lastName,displayName:a.firstName+' '+a.lastName,counterpartyEmail:a.email,shippingName:null,addressLine1:null,addressLine2:null,city:null,region:null,postalCode:null,countryCode:null,gross:a.amountCents/100,fee:0,net:a.amountCents/100,note:a.note}));
 });
}
