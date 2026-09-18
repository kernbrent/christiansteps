(()=>{
 const base=document.body.dataset.portal==='csm'?'/api/admin':'/api/interest/admin';
 const params=new URLSearchParams(location.hash.slice(1)),sourceOrigin=new URLSearchParams(location.search).get('sourceOrigin');history.replaceState(null,'',location.pathname);
 async function api(path,body,csrf=''){const r=await fetch(base+path,{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body?JSON.stringify(body):undefined}),data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to switch portals.');return data;}
 (async()=>{
  if(params.has('code')){await api('/switch/finish',{code:params.get('code')});location.replace('/admin/account/');return;}
  if(params.has('challenge')){const session=await api('/session');const result=await api('/switch/issue',{challenge:params.get('challenge')},session.csrfToken);location.replace(result.url);return;}
  const result=await api('/switch/start',{sourceOrigin});location.replace(result.url);
 })().catch(e=>document.querySelector('#status').textContent=e.message);
})();
