import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {expect,it} from 'vitest';
const source=readFileSync(new URL('../../admin/ledger/assets/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('  function incomeHasInvoiceDetails('),source.indexOf('  function tripWeekDates('));
const sync=new Function('clean',helpers+';return syncIncomeAmountRequirement;')((v:unknown)=>String(v||'').trim());
function form(edit=false){
 const elements:any={};
 for(const name of ['client_id','project_id','invoice_number','invoice_date','due_date','amount','donor_email','income_kind']){
  const label={hidden:false};elements[name]={value:'',disabled:false,required:false,closest:()=>label,setAttribute:()=>{}};
 }
 elements.income_kind.value='other';elements.invoice_number.value='INV-123';elements.donor_email.value='donor@example.test';
 return {elements,dataset:{id:edit?'existing':''}};
}
it('switches invoice and donor fields for all income types without losing draft values',()=>{
 const f=form();
 for(const kind of ['other','donation','earned','donation','other']){
  f.elements.income_kind.value=kind;sync(f);
  for(const name of ['client_id','project_id','invoice_number','invoice_date','due_date','amount']){
   expect(f.elements[name].disabled).toBe(kind==='donation');expect(f.elements[name].closest().hidden).toBe(kind==='donation');
  }
  expect(f.elements.donor_email.disabled).toBe(kind!=='donation');expect(f.elements.donor_email.closest().hidden).toBe(kind!=='donation');
  expect(f.elements.amount.required).toBe(kind!=='donation');
 }
 expect(f.elements.invoice_number.value).toBe('INV-123');expect(f.elements.donor_email.value).toBe('donor@example.test');
});
it('does not require the hidden invoice amount when editing a donation',()=>{
 const f=form(true);f.elements.income_kind.value='donation';sync(f);expect(f.elements.amount.required).toBe(false);
 f.elements.income_kind.value='earned';sync(f);expect(f.elements.amount.required).toBe(true);
});
