/* Phone formatting is presentation only; the API/database keep canonical values. */
(()=>{
 function format(value,country=''){
  if(typeof value!=='string')return value;const raw=value.trim(),c=String(country||'').toUpperCase();
  if(c&&!['US','USA','UNITED STATES','UNITED STATES OF AMERICA'].includes(c))return value;
  if(!/^[+\d().\s-]+$/.test(raw)||raw.startsWith('+')&&!raw.startsWith('+1'))return value;
  let d=raw.replace(/\D/g,'');if(d.length===11&&d.startsWith('1'))d=d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d)?`(${d.slice(0,3)})${d.slice(3,6)}-${d.slice(6)}`:value;
 }
 function records(value){if(Array.isArray(value)){value.forEach(records);return value;}if(value&&typeof value==='object'){for(const [key,v] of Object.entries(value)){if(/^(phone|billing_phone|billingPhone|cellPhone)$/.test(key))value[key]=format(v,value.country);else if(v&&typeof v==='object')records(v);}}return value;}
 window.HSPhones={format,records};
 const selector='input[type=tel],input[name=phone],input[name=billingPhone],input[name=billing_phone]';
 function apply(input){if(!(input instanceof HTMLInputElement)||!input.matches(selector))return;const country=input.form?.elements.namedItem('country')?.value||'';input.value=format(input.value,country);}
 document.addEventListener('focusout',e=>apply(e.target));
 document.addEventListener('input',e=>{const el=e.target;if(el instanceof HTMLInputElement&&el.matches(selector)&&el.selectionStart===el.value.length)apply(el);});
 const observer=new MutationObserver(()=>document.querySelectorAll(selector).forEach(el=>{if(el!==document.activeElement)apply(el);}));
 observer.observe(document.documentElement,{childList:true,subtree:true});document.querySelectorAll(selector).forEach(apply);
})();
