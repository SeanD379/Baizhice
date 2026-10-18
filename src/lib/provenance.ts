import type { Material, Prisma, Version } from '@prisma/client';
import { validatePages } from './generation';
import { generationSources, readGeneration } from './generation-store';
import type { Section } from './types';

// Check adopted excerpts against the same corrected pages used by answer feedback.
export async function validateSectionProvenance(section:Section,version:Version,materials:Material[],client:Prisma.TransactionClient) {
  if(!section.generation)return;
  const draft=await readGeneration(section.generation.draftId);
  if(draft.id!==section.generation.draftId||draft.courseId!==version.courseId)throw new Error('生成来源不属于当前课程。');
  if(draft.expectedVersionId!==null) {
    const original=await client.version.findUnique({where:{id:draft.expectedVersionId}});
    if(!original||original.courseId!==version.courseId||original.number>=version.number)throw new Error('生成来源的版本关系无法核对。');
  }
  const originalSection=draft.sections.find(s=>s.id===section.id);
  const available=(await generationSources(version.courseId,materials.filter(m=>section.refs.some(r=>r.materialId===m.id)))).pages;
  for(const ref of section.refs) {
    if(!originalSection?.refs.some(r=>r.materialId===ref.materialId&&r.page===ref.page&&r.snippet===ref.snippet))throw new Error('引用不属于保存的生成来源。');
    const pages=validatePages(draft.pages.filter(p=>p.materialId===ref.materialId&&p.page===ref.page),available);
    if(pages.length!==1||!pages[0].text.replace(/\s/g,'').includes(ref.snippet.replace(/\s/g,'')))throw new Error('引用摘录无法匹配已核对的生成文字。');
  }
}
