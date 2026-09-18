import {AdminError,adminJson,requireAllowedOrigin,readAdminJson} from './security';
type IdentityEnv=Env&{SHARED_SIGNIN?:string;IDENTITY?:Fetcher};
export function sharedEnabled(env:Env){return (env as IdentityEnv).SHARED_SIGNIN==='enabled';}
export async function identityRequest(request:Request,env:Env,path:string,body?:unknown):Promise<Response>{
 const binding=(env as IdentityEnv).IDENTITY;if(!binding)throw new AdminError(503,'IDENTITY_UNAVAILABLE','Shared account service is unavailable.');
 const headers=new Headers(request.headers);
 headers.delete('host');headers.delete('authorization');
 const cookies=(headers.get('cookie')||'').split(';').map(x=>x.trim());
 headers.set('cookie',cookies.filter(x=>x.startsWith('cs_admin_session=')||x.startsWith('mmt_switch=')).map(x=>x.replace(/^cs_admin_session=/,'hs_admin_session=')).join('; '));
 // Forward only the platform-provided client address for authority rate limits.
 headers.set('cf-connecting-ip',request.headers.get('cf-connecting-ip')||'unknown');
 const init:RequestInit={method:body===undefined?request.method:'POST',headers};
 if(body!==undefined){headers.set('content-type','application/json');init.body=JSON.stringify(body);}
 else if(!['GET','HEAD'].includes(request.method))init.body=JSON.stringify(await readAdminJson(request));
 let response:Response;
 try{response=await binding.fetch(new Request('https://identity.internal'+path,init));}
 catch{throw new AdminError(503,'IDENTITY_UNAVAILABLE','Shared account service is unavailable. Try again shortly.');}
 const resultHeaders=new Headers(response.headers);resultHeaders.delete('set-cookie');
 for(const value of response.headers.getSetCookie())resultHeaders.append('set-cookie',value.replace('hs_admin_session=','cs_admin_session=').replace(/Path=\/api\/interest(?:\/admin)?(?=;|$)/,'Path=/api/admin'));
 return new Response(response.body,{status:response.status,headers:resultHeaders});
}
export async function sharedRoutes(request:Request,env:Env,path:string):Promise<Response|null>{
 if(!sharedEnabled(env))return null;
 if(path==='/login'||['/session','/password','/logout'].includes(path)||path.startsWith('/account/')||path.startsWith('/switch/')||path.startsWith('/public/account/')){
  if(request.method!=='GET')requireAllowedOrigin(request,env);
  if(path==='/login'){const b=await readAdminJson(request);return identityRequest(request,env,'/admin/login',{...b,username:b.userId??b.username});}
  return identityRequest(request,env,path.startsWith('/public/')?path:'/admin'+path);
 }
 return null;
}
const authorizations=new WeakMap<Request,ReturnType<typeof authorize>>();
export function sharedAuthorize(request:Request,env:Env){let result=authorizations.get(request);if(!result){result=authorize(request,env);authorizations.set(request,result);}return result;}
async function authorize(request:Request,env:Env){
 if(!['GET','HEAD'].includes(request.method))requireAllowedOrigin(request,env);
 const path=new URL(request.url).pathname.replace(/^\/api\/admin/,'');
 const r=await identityRequest(request,env,'/authorize',{path,method:request.method}),data=await r.json() as {error?:string;code?:string;id:string;user_id:string;csrf_token:string;expires_at:string;user:{is_admin:boolean;permissions:Record<string,string>}};
 if(!r.ok)throw new AdminError(r.status,data.code||'ACCESS_DENIED',data.error||'Sign in to continue.');
 return data;
}
export async function recordSharedActivity(request:Request,env:Env,response:Response){
 const identity=authorizations.get(request);if(!identity||request.method==='GET')return;
 const session=await identity;
 await env.DB.prepare('INSERT INTO shared_account_activity(id,actor_user_id,method,path,response_status,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),session.user_id,request.method,new URL(request.url).pathname,response.status,new Date().toISOString()).run();
}
