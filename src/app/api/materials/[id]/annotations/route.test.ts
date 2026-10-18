import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({access:vi.fn(),material:vi.fn(),list:vi.fn(),image:vi.fn(),ocr:vi.fn(),save:vi.fn(),remove:vi.fn()}));
vi.mock('@/lib/private-access',()=>({requirePrivateAccess:mocks.access}));
vi.mock('@/lib/material-annotation-store',()=>({annotationMaterial:mocks.material,listMaterialAnnotations:mocks.list,readAnnotationImage:mocks.image,recognizeAnnotationImage:mocks.ocr,saveMaterialAnnotation:mocks.save,deleteMaterialAnnotation:mocks.remove}));
import { GET, POST, PATCH, DELETE } from './route';
const context={params:Promise.resolve({id:'material'})},uuid='11111111-1111-4111-8111-111111111111';
const input={anchor:{kind:'text',quote:'真实摘录',prefix:'',suffix:'',rects:[]},instruction:'整理适用条件',confirmedText:true};
const request=(method='GET',body?:object,origin?:string)=>new Request('http://127.0.0.1:4175/api/materials/material/annotations',{method,headers:{host:'127.0.0.1:4175','content-type':'application/json',...(origin?{origin}:{})},...(body&&method!=='GET'?{body:JSON.stringify(body)}:{})});
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue(null);mocks.material.mockResolvedValue({id:'material',courseId:'c',hash:'version'});mocks.list.mockResolvedValue([{id:uuid}]);mocks.save.mockResolvedValue({id:uuid});});
it.each(['GET','POST','PATCH','DELETE'] as const)('protects the %s annotation method before accessing private content',async(method)=>{
  const handler={GET,POST,PATCH,DELETE}[method];
  mocks.access.mockResolvedValue(new Response('login',{status:401}));expect((await handler(request(method,input),context)).status).toBe(401);
  for(const operation of [mocks.material,mocks.list,mocks.save,mocks.remove])expect(operation).not.toHaveBeenCalled();
});
it('rejects a foreign origin before reading or saving source excerpts',async()=>{
  expect((await POST(request('POST',input,'https://other.example'),context)).status).toBe(400);expect(mocks.material).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it('lists current-material comments without caching them',async()=>{
  const response=await GET(request(),context);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({annotations:[{id:uuid}],sourceHash:'version'});expect(mocks.list).toHaveBeenCalledWith('c','material');
});
it('saves the normalized selected excerpt without invoking recognition',async()=>{
  expect((await POST(request('POST',input),context)).status).toBe(200);expect(mocks.save).toHaveBeenCalledWith('material',input);expect(mocks.ocr).not.toHaveBeenCalled();
});
it.each([{...input,anchor:{...input.anchor,rects:[{x:.9,y:0,width:.5,height:.2}]}},{...input,instruction:''},{...input,id:uuid,revision:0}])('rejects invalid annotation bounds or revisions without a write',async(body)=>{
  const response=await ('revision' in body?PATCH:POST)(request('revision' in body?'PATCH':'POST',body),context);expect(response.status).toBe(400);expect(mocks.save).not.toHaveBeenCalled();
});
