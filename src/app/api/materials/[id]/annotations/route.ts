import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePrivateAccess } from '@/lib/private-access';
import { checkOrigin, errorResponse } from '@/lib/server';
import { annotationAnchorSchema } from '@/lib/material-study';
import { annotationMaterial,deleteMaterialAnnotation,listMaterialAnnotations,readAnnotationImage,recognizeAnnotationImage,saveMaterialAnnotation } from '@/lib/material-annotation-store';
export const runtime='nodejs';
const fields={anchor:annotationAnchorSchema,instruction:z.string().trim().min(1).max(2000),confirmedText:z.boolean(),image:z.string().max(4500000).optional()};
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const denied=await requirePrivateAccess(request);if(denied)return denied;
  try {checkOrigin(request);const {id}=await params,material=await annotationMaterial(id),image=new URL(request.url).searchParams.get('image');if(image)return new Response(new Uint8Array(await readAnnotationImage(id,image)),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store'}});return NextResponse.json({annotations:await listMaterialAnnotations(material.courseId,id),sourceHash:material.hash},{headers:{'Cache-Control':'no-store'}});}
  catch(error){return errorResponse(error);}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const denied=await requirePrivateAccess(request);if(denied)return denied;
  try {checkOrigin(request);const {id}=await params;await annotationMaterial(id);const body=await request.json();if(body.action==='recognize')return NextResponse.json(await recognizeAnnotationImage(z.string().max(4500000).parse(body.image)));return NextResponse.json({annotation:await saveMaterialAnnotation(id,z.object(fields).parse(body))});}
  catch(error){return errorResponse(error);}
}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  const denied=await requirePrivateAccess(request);if(denied)return denied;
  try {checkOrigin(request);return NextResponse.json({annotation:await saveMaterialAnnotation((await params).id,z.object({...fields,id:z.string().uuid(),revision:z.number().int().positive()}).parse(await request.json()))});}
  catch(error){return errorResponse(error);}
}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}) {
  const denied=await requirePrivateAccess(request);if(denied)return denied;
  try {checkOrigin(request);const input=z.object({id:z.string().uuid(),revision:z.number().int().positive()}).parse(await request.json());await deleteMaterialAnnotation((await params).id,input.id,input.revision);return NextResponse.json({deleted:true});}
  catch(error){return errorResponse(error);}
}
