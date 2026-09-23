(()=>{
 let observer;
 function show(session){const u=session.user;if(!u)return;
  if(u.must_change_password){location.replace('/admin/account/#password');return;}
  const finance=location.pathname.startsWith('/admin/ledger/'),section=finance?'finances':'giving';
  if(!u.is_admin&&!['read','edit'].includes(u.permissions[section])){location.replace('/admin/account/');return;}
  const nav=document.querySelector('.admin-nav,.header-actions');
  if(nav&&!nav.querySelector('[data-shared-account]')){if(!nav.querySelector('a[href="/admin/personal-gifts/"]')&&(u.is_admin||['read','edit'].includes(u.permissions.giving))){const gifts=document.createElement('a');gifts.href='/admin/personal-gifts/';gifts.textContent='Personally received gifts';nav.append(gifts);}const a=document.createElement('a');a.dataset.sharedAccount='true';a.href='/admin/account/';a.textContent=u.is_admin?'My profile & users':'My profile';nav.append(a);if(u.can_switch&&u.switch_url){const a=document.createElement('a');a.href=u.switch_url+'?sourceOrigin='+encodeURIComponent(location.origin);a.textContent='Switch to Hope Sojourns';nav.append(a);}}
  const readonly=!u.is_admin&&u.permissions[section]==='read';
  function update(){
   document.querySelectorAll('a').forEach(a=>{if(!u.is_admin&&a.getAttribute('href')==='#/paypal'&&!['read','edit'].includes(u.permissions.giving))a.hidden=true;});
   if(readonly)document.querySelectorAll('button,input,select,textarea').forEach(b=>{if(b.closest('[data-form],.record-form')||b.matches('[data-action="edit"],[data-action="delete"],[data-action="add"],[data-action^="add-"],[data-action^="edit-"],[data-action^="delete-"],[data-action^="record-"],[data-action^="save-"],[data-action^="upload-"],[data-action^="remove-"],[data-action^="mark-"],[data-action="toggle-category"]')||/^(Add |Create |Save|Delete|Remove|Import|Approve|Reject|Send |Upload|Replace|Mark |Record |Pull |Refresh full|Edit$)/i.test(b.textContent.trim())){b.disabled=true;b.title='Read-only access';}});
  }observer?.disconnect();update();observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true});
 }
 window.addEventListener('shared-session',e=>show(e.detail));
 fetch('/api/admin/session',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(s=>s&&show(s)).catch(()=>{});
})();
