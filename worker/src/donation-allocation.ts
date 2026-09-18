// Shared donation-allocation contract. Keep both portal copies identical.
export type DonationAllocation = {personId?:string; firstName:string; lastName:string; email:string; date:string; amountCents:number; note:string};
export function validateAllocations(value:unknown, totalCents:number):DonationAllocation[]{
 if(!Array.isArray(value)||value.length>100||(value.length>0&&value.length<2))throw new Error('Enter between 2 and 100 donors, or undo the split.');
 const clean=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u001f]/.test(v))throw new Error('Enter valid donor details.');return v.normalize('NFKC').trim();};
 const rows=value.map(v=>{
  if(!v||typeof v!=='object')throw new Error('Enter donor details.');
  const firstName=clean(v.firstName,70),lastName=clean(v.lastName,70),email=clean(v.email||'',254).toLowerCase(),date=clean(v.date,10),note=clean(v.note||'',1000);
  if(!firstName||!lastName||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new Error('Enter each donor’s first and last name and a valid email if available.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Choose a valid original donation date.');
  if(!Number.isSafeInteger(v.amountCents)||v.amountCents<=0)throw new Error('Each donation must be positive and use whole cents.');
  return {firstName,lastName,email,date,note,amountCents:v.amountCents,...(v.personId?{personId:clean(v.personId,80)}:{})};
 });
 if(rows.length&&rows.reduce((sum,r)=>sum+r.amountCents,0)!==totalCents)throw new Error('Donor amounts must equal the full charitable amount before fees.');
 return rows;
}
