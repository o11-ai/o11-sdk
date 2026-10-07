import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, open, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialStore, CliAuth } from '../src/vault';
import { credentialLockPath, withCredentialLock } from '../src/credential-lock';
const worker = new URL('./refresh-worker.ts',import.meta.url).pathname;
const scoped = async <T>(action: (root:string)=>Promise<T>) => {
 const old=process.env.O11_CONFIG_DIR, root=await mkdtemp(join(tmpdir(),'o11-refresh-test-'));
 process.env.O11_CONFIG_DIR=root;
 try{return await action(root);}finally{if(old===undefined)delete process.env.O11_CONFIG_DIR;else process.env.O11_CONFIG_DIR=old;await rm(root,{recursive:true,force:true});}
};

for (const execution of ['adapter', 'cli'] as const) test(`two independent ${execution} processes rotate once and both retain the new refresh grant`, async()=>scoped(async root=>{
 let refreshes=0, invalidGrants=0;
 const waiting: (()=>void)[]=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/barrier'){
   await new Promise<void>(resolve=>{waiting.push(resolve);if(waiting.length===2)for(const release of waiting)release();});
   return new Response('ready');
  }
  if(url.pathname==='/token'){
   const body=new URLSearchParams(await request.text());
   expect(body.get('grant_type')).toBe('refresh_token');
   expect(body.get('scope')).toBeNull(); // Refresh may not widen granted scopes.
   refreshes++;
   if(body.get('refresh_token')!=='test-refresh-old'||refreshes!==1){invalidGrants++;return Response.json({error:'invalid_grant'},{status:400});}
   await Bun.sleep(100);
   return Response.json({access_token:'test-access-new',refresh_token:'test-refresh-new',token_type:'Bearer',scope:'o11:read',expires_in:300});
  }
  if(url.pathname==='/mcp' || url.pathname==='/api/agent/v1/status'){
   if(request.headers.get('authorization') !== 'Bearer test-access-new'){
    await new Promise<void>(resolve=>{waiting.push(resolve);if(waiting.length===2)for(const release of waiting)release();});
    return new Response(null,{status:401});
   }
   if(url.pathname==='/api/agent/v1/status') return Response.json({result:{ready:true}});
   return createMcpHandler(()=>{
    const mcp=new McpServer({name:'synthetic-qa',version:'1.0.0'});
    mcp.registerTool('o11_setup',{inputSchema:z.object({})},async()=>({content:[{type:'text',text:'synthetic setup'}],structuredContent:{ready:true}}));
    return mcp;
   },{legacy:'stateless',responseMode:'sse'}).fetch(request);
  }
  return new Response(null,{status:404});
 }});
 try{
  const endpoint=new URL('mcp',server.url);
  const issuer=server.url.origin;
  const store=await credentialStore('qa-race',endpoint,'file');
  await store.write(JSON.stringify({clients:{[issuer]:{client_id:'test-client',issuer}},tokens:{access_token:'test-access-old',refresh_token:'test-refresh-old',token_type:'Bearer',scope:'o11:read',issuer},discovery:{authorizationServerUrl:issuer,authorizationServerMetadata:{issuer,token_endpoint:`${issuer}/token`,authorization_endpoint:`${issuer}/authorize`,response_types_supported:['code'],token_endpoint_auth_methods_supported:['none']},resourceMetadata:{resource:endpoint.href,authorization_servers:[issuer],scopes_supported:['o11:read']}}}));
  const command=execution === 'adapter' ? [process.execPath,worker,'refresh',endpoint.href] : [process.execPath,new URL('../dist/index.js',import.meta.url).pathname,'--profile','qa-race','--server',endpoint.href,'--credential-store','file','status'];
  const spawn=()=>Bun.spawn(command,{env:{...process.env,O11_CONFIG_DIR:root},stdout:'pipe',stderr:'pipe'});
  const children=[spawn(),spawn()];
  const output=await Promise.all(children.map(async child=>({exit:await child.exited,out:await new Response(child.stdout).text(),err:await new Response(child.stderr).text()})));
  expect(output.map(item=>item.exit)).toEqual([0,0]);
  expect(output.every(item=>execution === 'adapter' ? JSON.parse(item.out).refreshed===true : JSON.parse(item.out).result.ready===true)).toBeTrue();
  expect(output.every(item=>!item.err.includes('invalid_grant'))).toBeTrue();
  expect(refreshes).toBe(1);expect(invalidGrants).toBe(0);
  if(execution==='cli'){
   const args=command.slice(1,-1).concat('mcp');
   for (const mode of ['modern', 'legacy'] as const) {
   const bridge=new Client({name:'synthetic-bridge-test',version:'1.0.0'}, { versionNegotiation: { mode: mode === 'modern' ? { pin: '2026-07-28' } : 'legacy' } });
   const stdio=new StdioClientTransport({command:process.execPath,args,env:Object.fromEntries(Object.entries({...process.env,O11_CONFIG_DIR:root}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),stderr:'pipe'});
   try{
    await bridge.connect(stdio);
    expect((await bridge.listResourceTemplates()).resourceTemplates).toEqual([]);
    expect((await bridge.listTools()).tools.some(tool=>tool.name==='o11_setup')).toBeTrue();
    const parallel=spawn();expect(await parallel.exited).toBe(0);
    expect((await bridge.callTool({name:'o11_setup',arguments:{}})).structuredContent).toEqual({ready:true});
    expect(refreshes).toBe(1); // A live stdio bridge does not hold a process-lifetime lock.
   }finally{await bridge.close();}
   }
  }
  const saved=JSON.parse((await store.read())!);
  expect(saved.tokens.refresh_token).toBe('test-refresh-new');expect(saved.tokens.scope).toBe('o11:read');
  const provider=await new CliAuth('http://127.0.0.1:49191/callback',store,async()=>{}).load();
  await store.exclusive!(()=>store.clear());
  expect(await provider.transportAuth().token()).toBeUndefined(); // A running bridge must honor logout.
 }finally{server.stop(true);}
}));

test('dead process owner is recovered; live owner times out without lock stealing', async()=>scoped(async root=>{
 const server=new URL('https://issuer.example/mcp');
 const child=Bun.spawn([process.execPath,worker,'hold',server.href],{env:{...process.env,O11_CONFIG_DIR:root},stdout:'pipe',stderr:'ignore'});
 const reader=child.stdout.getReader();await reader.read();await reader.cancel();
 const path=credentialLockPath('qa-race',server,'file');
 const before=await readdir(path);
 await expect(withCredentialLock('qa-race',server,'file',async()=>{}, {waitMs:80})).rejects.toThrow('Another command');
 expect(await readdir(path)).toEqual(before);
 child.kill('SIGKILL');await child.exited;
 let active=0,max=0;
 const recovered=await Promise.all(Array.from({length:6},()=>withCredentialLock('qa-race',server,'file',async()=>{active++;max=Math.max(max,active);await Bun.sleep(5);active--;return 'recovered';},{waitMs:1000})));
 expect(recovered).toEqual(Array(6).fill('recovered'));expect(max).toBe(1);
}));

test('orphaned empty directory recovers and different profiles and servers do not block', async()=>scoped(async()=>{
 const server=new URL('https://issuer.example/mcp');
 const path=credentialLockPath('qa-race',server,'file');
 await mkdir(path,{recursive:true,mode:0o700});await utimes(path,new Date(0),new Date(0));
 expect(await withCredentialLock('qa-race',server,'file',async()=>true,{waitMs:1000})).toBeTrue();
 await withCredentialLock('qa-race',server,'file',async()=>{
  expect(await withCredentialLock('other',server,'file',async()=>true,{waitMs:100})).toBeTrue();
  expect(await withCredentialLock('qa-race',new URL('https://other.example/mcp'),'file',async()=>true,{waitMs:100})).toBeTrue();
 });
}));

test('same-process simultaneous refreshes serialize and failed actions always release',async()=>scoped(async()=>{
 const server=new URL('https://issuer.example/mcp');let active=0,max=0;
 await Promise.all(Array.from({length:8},()=>withCredentialLock('qa-race',server,'file',async()=>{active++;max=Math.max(max,active);await Bun.sleep(10);active--;})));
 expect(max).toBe(1);
 await expect(withCredentialLock('qa-race',server,'file',async()=>{throw new Error('synthetic failure');})).rejects.toThrow('synthetic failure');
 expect(await withCredentialLock('qa-race',server,'file',async()=>true)).toBeTrue();
}));

test('bounded authentication timeout releases coordination without erasing a valid refresh grant',async()=>scoped(async()=>{
 const { coordinatedAuth }=await import('../src/coordinated-auth');
 const server=new URL('https://issuer.example/mcp'),issuer=server.origin;
 const store=await credentialStore('qa-race',server,'file');
 await store.write(JSON.stringify({clients:{[issuer]:{client_id:'test-client',issuer}},tokens:{access_token:'test-old',refresh_token:'test-refresh',token_type:'Bearer',issuer},discovery:{authorizationServerUrl:issuer,authorizationServerMetadata:{issuer,token_endpoint:`${issuer}/token`,authorization_endpoint:`${issuer}/authorize`,response_types_supported:['code']},resourceMetadata:{resource:server.href,authorization_servers:[issuer]}}}));
 const provider=await new CliAuth('http://127.0.0.1:49191/callback',store,async()=>{throw new Error('Explicit sign-in required.');}).load();
 const adapter=coordinatedAuth(provider,20);await adapter.token();
 await expect(adapter.onUnauthorized!({serverUrl:server,response:new Response(null,{status:401}),fetchFn:async(_input,init)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')),{once:true});})})).rejects.toThrow('Timed out');
 expect(JSON.parse((await store.read())!).tokens.refresh_token).toBe('test-refresh');
 expect(await store.exclusive!(async()=>true)).toBeTrue();
}));
