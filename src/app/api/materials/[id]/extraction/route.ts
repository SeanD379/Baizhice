import { requirePrivateAccess } from '@/lib/private-access';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkOrigin, errorResponse } from '@/lib/server';
import { extractMaterial, isExtracting, readExtraction } from '@/lib/extraction';
export const runtime='nodejs';
export const maxDuration=120;
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const denied = await requirePrivateAccess(_request); if (denied) return denied;
  try{const {id}=await params;if(!await db.material.findUnique({where:{id}}))return NextResponse.json({error:'资料不存在。'},{status:404});return NextResponse.json({result:await readExtraction(id),running:isExtracting(id)},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const denied = await requirePrivateAccess(request); if (denied) return denied;
  try{checkOrigin(request);const body=await request.text();const options=body?JSON.parse(body):{};if(options.continue!==undefined&&typeof options.continue!=='boolean')throw new Error('继续处理参数无效。');const {id}=await params;const material=await db.material.findUnique({where:{id}});if(!material)return NextResponse.json({error:'资料不存在。'},{status:404});return NextResponse.json({result:await extractMaterial(material,{continue:options.continue===true})},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}
}
