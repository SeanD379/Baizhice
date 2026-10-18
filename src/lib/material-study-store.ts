import { randomUUID } from 'node:crypto';
import { db } from './db';
import { deepSeekConfig,generateWithDeepSeek } from './deepseek';
import { generationSources } from './generation-store';
import { hashContent,validateOutput,type SourcePage } from './generation';
import { annotationLocation,listMaterialAnnotations,readAnnotationImage } from './material-annotation-store';
import { conceptReferences,knowledgeBatches,mergeStudyCandidates,normalizeQuote,questionOnlyContent,studyQuestionBody,studyPresetSchema,studyDestination,type StudyDestination,validateSupplementOutput,type MaterialStudyTask,type StudyCandidate,type StudyPreset,type StudyTarget } from './material-study';
import { validateAutomaticStudy } from './material-study-automatic';
import { adoptStudyQuestions, questionBankSourceHash } from './question-bank-store';
import type { OriginalQuestion } from './question-bank-types';
import { adoptNotebookSections,NotebookConflict } from './notebook-store';
import type { Section, Reference } from './types';
import { readExtraction } from './extraction';
import { parseOriginalQuestions } from './question-bank';
import { sourceLocation } from './document-labels';
import type { NotebookDocument } from './notebook';
import { readExamProtection } from './exam-protection';
import { aiAssistantText } from './ai-assistant';
import { questionRefKey } from './practice-hub';

type TaskContent = Omit<MaterialStudyTask,'id'|'courseId'|'revision'|'createdAt'|'updatedAt'|'stale'|'withheld'> & {originalQuestions?:OriginalQuestion[];pages:(SourcePage & {annotationRef?:Reference})[];hashes:Record<string,string>;annotationRevisions:Record<string,number>;annotationSources?:{id:string;refs:Reference[]}[];instructions:{materialId:string;page:number;quote:string;instruction:string;annotationId?:string;anchor?:Reference['anchor'];hasImage?:boolean;recognition?:import('./material-study').AnnotationAnchor['recognition']}[]};
function taskBatches(content:Pick<TaskContent,'pages'|'instructions'>){const batches=knowledgeBatches(content.pages);return content.instructions.some(item=>item.hasImage)?batches.flatMap(batch=>Array.from({length:Math.ceil(batch.length/8)},(_,index)=>batch.slice(index*8,index*8+8))):batches;}
type TaskRow={id:string;courseId:string;revision:number;content:string;createdAt:Date;updatedAt:Date};
const runtime=(globalThis as unknown as {materialStudyRuntime?:{active:Map<string,Promise<void>>;queued:Set<string>}}).materialStudyRuntime??={active:new Map(),queued:new Set()};
const decode=(row:TaskRow):TaskContent=>JSON.parse(row.content);
const examMessage='所选资料有未交卷考试，请交卷后再整理、审核或收录。已有草稿保留。';
const publicTask=(row:TaskRow,stale=false,withheld=false):MaterialStudyTask=>{const {pages,hashes,annotationRevisions,annotationSources,originalQuestions,instructions,...content}=decode(row);void pages;void hashes;void annotationRevisions;void annotationSources;void originalQuestions;void instructions;return {...content,error:aiAssistantText(content.error),warnings:content.warnings.map(aiAssistantText),sections:content.sections.map(section=>content.preset==='concepts'||section.generation?.contentOrigin==='ai-supplement'?{...section,refs:conceptReferences(section.title,section.refs)}:section),preset:content.preset??'notes',...(withheld?{sections:[],warnings:[examMessage],error:'',withheld:true}:{}),id:row.id,courseId:row.courseId,revision:row.revision,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),stale};};
async function assertNoExam(courseId:string,materialIds:string[],client?:Parameters<typeof readExamProtection>[1]){const protection=await readExamProtection(courseId,client);if(materialIds.some(id=>protection.withheldMaterials.includes(id)))throw new Error(examMessage);}
async function taskRow(courseId:string,id:string){const row=await db.materialStudyTask.findFirst({where:{id,courseId}});if(!row)throw new Error('整理任务不存在。');return row;}
async function persist(row:TaskRow,content:TaskContent){const changed=await db.materialStudyTask.updateMany({where:{id:row.id,revision:row.revision},data:{content:JSON.stringify(content),revision:{increment:1}}});if(changed.count!==1)throw new Error('草稿已在另一页面更新，请刷新后重试。');return db.materialStudyTask.findUniqueOrThrow({where:{id:row.id}});}
async function automaticQuestions(materials:{id:string;name:string;hash:string}[]){return (await Promise.all(materials.map(async material=>{const extraction=await readExtraction(material.id);if(!extraction)return [];const parsed=parseOriginalQuestions(material,extraction.pages);if(extraction.continuation?.hasMore)parsed.pop();const bank=await db.originalQuestionBank.findUnique({where:{materialId_sourceHash:{materialId:material.id,sourceHash:questionBankSourceHash(extraction,material.hash)}}}),saved:OriginalQuestion[]=bank?JSON.parse(bank.content).questions:[];return parsed.map(question=>saved.find(item=>item.id===question.id)??question);}))).flat();}
async function sourceChanged(row:TaskRow) {
  const content=decode(row),materials=await db.material.findMany({where:{courseId:row.courseId,id:{in:content.materialIds}}});
  if(materials.length!==content.materialIds.length||materials.some(material=>material.hash!==content.hashes[material.id]||material.excluded||!!material.conflictResolution||material.status==='review'))return true;
  const available=await generationSources(row.courseId,materials);
  if(content.pages.some(page=>{const current=available.pages.find(item=>item.materialId===page.materialId&&(page.annotationRef?item.extractionHash===page.extractionHash:item.page===page.page));return current?current.extractionHash!==page.extractionHash:!!page.extractionHash;}))return true;
  if(content.annotationIds.length){const annotations=await listMaterialAnnotations(row.courseId);if(content.annotationIds.some(id=>!annotations.some(annotation=>annotation.id===id&&!annotation.stale&&annotation.revision===content.annotationRevisions[id])))return true;}
  if(content.routing==='auto'){const ids=content.sections.filter(section=>section.question&&section.review!=='adopted').map(section=>section.question!.id),snapshots=(content.originalQuestions??[]).filter(question=>!content.sections.length||ids.includes(question.id));if(snapshots.length){const current=await automaticQuestions(materials);if(snapshots.some(question=>JSON.stringify(current.find(item=>item.id===question.id))!==JSON.stringify(question)))return true;}}
  return false;
}
async function readTask(initial:TaskRow,protectedIds:string[]) {
  let row=initial,content=decode(row);const id=row.id;
  if(content.materialIds.some(materialId=>protectedIds.includes(materialId)))return publicTask(row,false,true);
  if(['running','queued'].includes(content.state)&&!runtime.active.has(id)&&!runtime.queued.has(id)){row=await db.materialStudyTask.findUniqueOrThrow({where:{id}});content=decode(row);if(['running','queued'].includes(content.state)&&!runtime.active.has(id)&&!runtime.queued.has(id))row=await persist(row,{...content,state:content.sections.length?'partial':'failed',error:'上次整理已中断，已完成内容保留。点击重试继续未完成批次。'});}
  return publicTask(row,await sourceChanged(row));
}
export async function getMaterialStudyTask(courseId:string,id:string) {
  const [row,protection]=await Promise.all([taskRow(courseId,id),readExamProtection(courseId)]);
  return readTask(row,protection.withheldMaterials);
}
export async function listMaterialStudyTasks(courseId:string,materialId?:string) {
  const [rows,protection]=await Promise.all([db.materialStudyTask.findMany({where:{courseId},orderBy:{updatedAt:'desc'},...(materialId?{}:{take:100})}),readExamProtection(courseId)]);
  return Promise.all(rows.filter(row=>!materialId||decode(row).materialIds.includes(materialId)).slice(0,100).map(row=>readTask(row,protection.withheldMaterials)));
}
async function runTask(id:string) {
  let row=await db.materialStudyTask.findUniqueOrThrow({where:{id}}),content=decode(row);
  try {
    await assertNoExam(row.courseId,content.materialIds);
    if(await sourceChanged(row))throw new Error('原文件、识别文字或批注已变化，请重新选择范围；旧草稿保留。');
    row=await persist(row,{...content,state:'running',error:''});content=decode(row);
    const batches=taskBatches(content);
    for(let index=content.done;index<batches.length;index++) {
      await assertNoExam(row.courseId,content.materialIds);
      const pages=batches[index],instructions=content.instructions.filter(annotation=>pages.some(page=>page.materialId===annotation.materialId&&page.page===annotation.page)),preset=content.preset??'notes';
      const images=new Map<string,string>();
      for(const instruction of instructions)if(instruction.hasImage&&instruction.annotationId&&!images.has(instruction.annotationId))images.set(instruction.annotationId,`data:image/png;base64,${(await readAnnotationImage(instruction.materialId,instruction.annotationId)).toString('base64')}`);
      const questions=(content.originalQuestions??[]).filter(question=>pages.some(page=>page.materialId===question.materialId&&page.page===question.sources[0]?.page));
      const generated=content.routing==='auto'?await generateWithDeepSeek(pages,[],'auto',questions):await generateWithDeepSeek(pages,instructions.map(instruction=>({...instruction,...(images.has(instruction.annotationId??'')?{image:images.get(instruction.annotationId!)}:{})})),preset);
      await assertNoExam(row.courseId,content.materialIds);
      const checked=content.routing==='auto'?validateAutomaticStudy(generated.output,pages,questions,generated.model,row.id):preset==='concepts'||images.size?validateSupplementOutput(generated.output,(content.annotationSources??[]).filter(annotation=>instructions.some(instruction=>instruction.annotationId===annotation.id)),generated.model,row.id,preset==='concepts'):validateOutput(generated.output,pages,generated.model,row.id);
      if(await sourceChanged(row))throw new Error('生成期间来源变化，未收录新内容。请核对后重新整理。');
      const sections=checked.sections.map(section=>({...section,id:`${row.id}:${index}:${section.id}`,generation:{...section.generation!,contentOrigin:preset==='concepts'?'ai-supplement' as const:'source' as const},refs:preset==='concepts'||images.size?section.refs:section.refs.map(ref=>{const annotation=content.instructions.find(item=>item.materialId===ref.materialId&&item.page===ref.page&&normalizeQuote(item.quote).includes(normalizeQuote(ref.snippet)));const mapped=pages.find(page=>page.materialId===ref.materialId&&page.page===ref.page) as TaskContent['pages'][number]|undefined;return {...ref,...mapped?.annotationRef,snippet:ref.snippet,location:mapped?.annotationRef?.location??annotationLocation(ref.name),sourceHash:content.hashes[ref.materialId],anchor:mapped?.annotationRef?.anchor??(annotation?annotation.anchor??{quote:annotation.quote}:undefined)};})}));
      const next=mergeStudyCandidates(content.sections,sections);
      const conflicts=sections.filter(section=>content.sections.some(old=>normalizeQuote(old.title)===normalizeQuote(section.title)&&normalizeQuote(old.body)!==normalizeQuote(section.body))).map(section=>`“${section.title}”有不同表述，分别保留，请结合出处核对。`);
      content={...content,done:index+1,sections:next,warnings:[...new Set([...content.warnings,...checked.warnings.map(warning=>{for(const page of pages)warning=warning.replace(`${page.name} 第 ${page.page} 页`,`${page.name} ${page.annotationRef?'原文件选定区域':sourceLocation(page.name,page.page)}`);return warning;}),...conflicts])]};
      row=await persist(row,content);
    }
    await persist(row,{...content,state:content.warnings.some(warning=>/提取不完整|未提取出|未纳入|尚未处理|未被本次候选引用/.test(warning))?'partial':'ready',error:''});
  } catch(error) {
    const latest=await db.materialStudyTask.findUnique({where:{id}});
    if(latest)await persist(latest,{...decode(latest),state:decode(latest).sections.length?'partial':'failed',error:error instanceof Error?error.message:'整理失败，已完成草稿保留。'});
  }
}
function drainTasks(){for(const id of runtime.queued){if(runtime.active.size>=2)break;runtime.queued.delete(id);const promise=runTask(id).catch(error=>console.error('Material study:',error)).finally(()=>{runtime.active.delete(id);drainTasks();});runtime.active.set(id,promise);}}
export async function organizeMaterial(input:{courseId:string;mode:'material'|'annotations';routing?:'auto';preset?:StudyPreset;materialIds?:string[];annotationIds?:string[];confirmed:boolean;taskId?:string}) {
  if(!input.confirmed)throw new Error('请先确认发送所选资料给 AI。');

  if(input.taskId){const row=await taskRow(input.courseId,input.taskId),content=decode(row);await assertNoExam(input.courseId,content.materialIds);if(!deepSeekConfig().configured)throw new Error('尚未配置 DeepSeek，已有草稿保留。');if(await sourceChanged(row))throw new Error('资料或批注变化，请重新选择范围；已有草稿保留。');if(content.state==='ready'||content.done>=content.total&&!content.error)return getMaterialStudyTask(input.courseId,row.id);if(!runtime.active.has(row.id)&&!runtime.queued.has(row.id)){await persist(row,{...content,state:'queued',error:''});runtime.queued.add(row.id);drainTasks();}return getMaterialStudyTask(input.courseId,row.id);}
  const preset=studyPresetSchema.parse(input.preset??'notes');
  if(input.routing==='auto'&&input.mode!=='material')throw new Error('自动分类整理只用于整份资料。');
  if(preset==='concepts'&&input.mode!=='annotations')throw new Error('补充概念解释只针对所选批注，请先勾选已核对的批注。');
  const allAnnotations=input.mode==='annotations'?await listMaterialAnnotations(input.courseId):[];
  const ids=input.annotationIds??[],annotations=allAnnotations.filter(annotation=>ids.includes(annotation.id));
  if(input.mode==='annotations'&&(!ids.length||new Set(ids).size!==ids.length||annotations.length!==ids.length||annotations.some(annotation=>annotation.stale||!annotation.confirmedText||!annotation.refs.length)))throw new Error('请选定已核对文字、来源仍有效的批注。');
  const materialIds=input.mode==='annotations'?[...new Set(annotations.map(annotation=>annotation.materialId))]:input.materialIds??[];
  if(!materialIds.length||new Set(materialIds).size!==materialIds.length)throw new Error('请选择有效资料。');
  const materials=await db.material.findMany({where:{id:{in:materialIds},courseId:input.courseId,excluded:false,status:{not:'review'},conflictResolution:null}});
  if(materials.length!==materialIds.length)throw new Error('资料不存在、已排除或尚有待核对冲突。');
  await assertNoExam(input.courseId,materialIds);
  const sources=await generationSources(input.courseId,materials);
  let pages:TaskContent['pages']=sources.pages;
  const instructions:TaskContent['instructions']=[];
  if(input.mode==='annotations'){
    const selected=new Map<string,TaskContent['pages'][number]>();
    for(const annotation of annotations)for(const ref of annotation.refs){
      const region=annotation.anchor.kind==='region'&&(annotation.hasImage||ref.location==='image');
      const key=region?annotation.id:`${ref.materialId}:${ref.page}`,original=sources.pages.find(page=>page.materialId===ref.materialId&&page.page===ref.page),old=selected.get(key);
      const pageNumber=region?(old?.page??1000000+selected.size):ref.page;
      const text=region?annotation.anchor.quote:old?.text??original?.text??'';
      selected.set(key,{materialId:ref.materialId,name:ref.name,page:pageNumber,text:normalizeQuote(text).includes(normalizeQuote(ref.snippet))?text:[text,ref.snippet].filter(Boolean).join('\n'),extractionHash:region?annotation.extractionHash:original?.extractionHash??'',method:region?'local-ocr':original?.method??'local-ocr',warnings:original?.warnings??[],...(region?{annotationRef:ref}:{})});
      instructions.push({materialId:ref.materialId,page:pageNumber,quote:ref.snippet,instruction:annotation.instruction,annotationId:annotation.id,...(annotation.hasImage?{hasImage:true}:{}),...(annotation.anchor.recognition?{recognition:annotation.anchor.recognition}:{}),anchor:{quote:annotation.anchor.quote,prefix:annotation.anchor.prefix,suffix:annotation.anchor.suffix,rects:annotation.anchor.rects,displayPage:annotation.anchor.displayPage}});
    }
    pages=[...selected.values()];
  }
  const questionOnly=await Promise.all(materials.map(async material=>{if(annotations.some(annotation=>annotation.materialId===material.id&&annotation.hasImage&&!annotation.anchor.quote.trim()))return false;const extraction=await readExtraction(material.id);return extraction?questionOnlyContent(pages.filter(page=>page.materialId===material.id),parseOriginalQuestions(material,extraction.pages)):false;}));
  if(input.routing!=='auto'&&preset!=='concepts'&&questionOnly.every(Boolean))throw new Error('选定范围主要是原题，未包含可靠讲解。原题会导入练习中心；请补充讲义后再整理知识结论。');
  if(!deepSeekConfig().configured)throw new Error('尚未配置 DeepSeek，批注与原题仍可保存。');
  if(!pages.length)throw new Error('没有可整理的文字，请先读取文件或核对框选区域的文字。');
  const batches=taskBatches({pages,instructions}),hashes=Object.fromEntries(materials.map(material=>[material.id,material.hash])),annotationRevisions=Object.fromEntries(annotations.map(annotation=>[annotation.id,annotation.revision]));
  const originalQuestions=input.routing==='auto'?await automaticQuestions(materials):undefined;
  const fingerprint=hashContent(JSON.stringify({mode:input.mode,preset,...(input.routing?{routing:input.routing,questions:hashContent(JSON.stringify(originalQuestions))}:{}),hashes,pages:pages.map(page=>[page.materialId,page.page,page.extractionHash,hashContent(page.text)]),annotations:annotations.map(annotation=>[annotation.id,annotation.revision]).sort(),...(annotations.some(annotation=>annotation.hasImage)?{vision:1}:{})}));
  const content:TaskContent={mode:input.mode,preset,...(input.routing?{routing:input.routing,originalQuestions}:{}),materialIds,annotationIds:ids,state:'queued',done:0,total:batches.length,sections:[],warnings:[...sources.unavailable,...annotations.filter(annotation=>annotation.anchor.kind==='region'&&!annotation.hasImage).map(annotation=>`${annotation.name}：包含用户核对后的区域文字，请同时对照原图。`)],error:'',pages,hashes,annotationRevisions,annotationSources:annotations.map(annotation=>({id:annotation.id,refs:annotation.refs})),instructions};
  const row=await db.materialStudyTask.upsert({where:{courseId_fingerprint:{courseId:input.courseId,fingerprint}},create:{id:randomUUID(),courseId:input.courseId,fingerprint,content:JSON.stringify(content)},update:{}});
  const old=decode(row);
  if((old.state==='queued'||old.state==='running')&&!runtime.active.has(row.id)&&!runtime.queued.has(row.id)){runtime.queued.add(row.id);drainTasks();}
  return getMaterialStudyTask(input.courseId,row.id);
}
export async function reviseMaterialStudy(input:{courseId:string;taskId:string;revision:number;edits?:{id:string;title:string;body:string;excluded?:boolean;destination?:StudyDestination;question?:Pick<OriginalQuestion,'prompt'|'answer'|'explanation'>}[];approveIds?:string[]}) {
  const row=await taskRow(input.courseId,input.taskId),content=decode(row);
  await assertNoExam(input.courseId,content.materialIds);
  if(row.revision!==input.revision)throw new Error('草稿已更新，请刷新；当前编辑可以保留。');
  if(['queued','running'].includes(content.state))throw new Error('整理尚未结束，请等待后审核。');
  const changes=new Map((input.edits??[]).map(edit=>[edit.id,edit])),approvals=new Set(input.approveIds??[]);
  if(changes.size!==(input.edits?.length??0)||[...changes.keys(),...approvals].some(id=>!content.sections.some(section=>section.id===id&&section.review!=='adopted')))throw new Error('候选已变化或已收录，请刷新。');
  if([...changes].some(([id,edit])=>edit.question&&!content.sections.find(section=>section.id===id)?.question))throw new Error('草稿类型不匹配。');
  if([...changes].some(([id,edit])=>edit.destination&&edit.destination!=='notebook'&&!content.sections.find(section=>section.id===id)?.question))throw new Error('只有题目草稿可以收录到练习中心。');
  const sections=content.sections.map(section=>{const edit=changes.get(section.id),question=section.question&&edit?.question?{...section.question,...edit.question,answerSource:edit.question.answer!==section.question.answer?(edit.question.answer.trim()?'manual' as const:'none' as const):section.question.answerSource}:section.question,body=question?studyQuestionBody(question):edit?.body??section.body,modified=edit&&(edit.title!==section.title||body!==section.body||!!edit.destination&&edit.destination!==studyDestination(section));return {...section,...edit,question,body,edited:section.edited||!!modified,review:modified?'pending' as const:approvals.has(section.id)?'approved' as const:section.review};});
  await persist(row,{...content,sections});
  return getMaterialStudyTask(input.courseId,row.id);
}
export async function adoptMaterialStudy(input:{courseId:string;taskId:string;revision:number;chosenIds:string[];notebookRevision?:number;targets:StudyTarget[]}) {
  const initial=await taskRow(input.courseId,input.taskId);
  await assertNoExam(input.courseId,decode(initial).materialIds);
  if(await sourceChanged(initial))throw new Error('来源变化，草稿保留但暂不能收录，请重新核对。');
  const saved=await db.$transaction(async tx=>{
    const row=await tx.materialStudyTask.findUniqueOrThrow({where:{id:input.taskId}}),content=decode(row);
    await assertNoExam(input.courseId,content.materialIds,tx);
    const sections=content.sections.filter(section=>input.chosenIds.includes(section.id));
    if(!input.chosenIds.length||new Set(input.chosenIds).size!==input.chosenIds.length||sections.length!==input.chosenIds.length||sections.some(section=>section.review==='pending'||section.excluded))throw new Error('请先审核通过所选内容。');
    if(sections.every(section=>section.review==='adopted'))return row;
    if(row.revision!==input.revision)throw new Error('草稿已在另一页面更新，请刷新。');
    if(new Set(input.targets.map(target=>target.sectionId)).size!==input.targets.length||input.targets.some(target=>!input.chosenIds.includes(target.sectionId)))throw new Error('收录位置不匹配。');
    const approved=sections.filter(section=>section.review==='approved'),practice=approved.filter(section=>studyDestination(section)!=='notebook'),incoming=approved.filter(section=>studyDestination(section)==='notebook').map(section=>({...section,refs:content.preset==='concepts'||section.generation?.contentOrigin==='ai-supplement'?conceptReferences(section.title,section.refs):section.refs,needsReview:false}));
    if(practice.some(section=>!section.question))throw new Error('练习草稿缺少原题，请重新整理。');
    if(input.targets.some(target=>!incoming.some(section=>section.id===target.sectionId)))throw new Error('收录位置不匹配。');
    let document:NotebookDocument|undefined;
    if(incoming.length){if(!input.notebookRevision)throw new Error('请先读取活页后再收录知识点。');const notebook=await adoptNotebookSections(input.courseId,incoming,input.targets,input.notebookRevision,tx,true);document=JSON.parse(notebook.content);}
    for(const destination of ['practice','papers','mistakes'] as const){const group=practice.filter(section=>studyDestination(section)===destination);if(group.length)await adoptStudyQuestions(input.courseId,group.map(section=>section.question!),tx,content.originalQuestions,destination==='papers'?'papers':destination==='mistakes'?'source':'knowledge');}
    for(const section of practice.filter(section=>section.destination==='mistakes')){const ref={engine:'original' as const,materialId:section.question!.materialId,questionId:section.question!.id},refKey=questionRefKey(ref);await tx.practiceQuestionState.upsert({where:{courseId_refKey:{courseId:input.courseId,refKey}},create:{courseId:input.courseId,refKey,ref:JSON.stringify(ref),manualWrong:true},update:{manualWrong:true,consolidatedAt:null,revision:{increment:1}}});}
    const completed:StudyCandidate[]=content.sections.map(section=>{if(practice.some(item=>item.id===section.id))return {...section,review:'adopted',practice:{materialId:section.question!.materialId,questionId:section.question!.id,section:studyDestination(section)==='papers'?'papers':studyDestination(section)==='mistakes'?'mistakes':'knowledge'}};if(!incoming.some(item=>item.id===section.id))return section;const blockId=`ai-${section.generation?.draftId??'legacy'}-${section.id}`;const adopted=document!.pages.filter(page=>JSON.stringify(page.doc).includes(`"id":"${blockId}"`)).map(page=>({pageId:page.id,pageTitle:page.title,chapterTitle:document!.chapters.find(chapter=>chapter.id===page.chapterId)?.title??'未分类'}));return {...section,review:'adopted',adopted};});
    if(incoming.length){
    const latest=await tx.version.findFirst({where:{courseId:input.courseId},orderBy:{number:'desc'}}),existing:Section[]=latest?JSON.parse(latest.content):[],merged=[...existing,...incoming.filter(section=>!existing.some(old=>old.id===section.id))];
    await tx.version.create({data:{courseId:input.courseId,number:(latest?.number??0)+1,title:latest?.title??'学习资料整理',content:JSON.stringify(merged),sourceIds:JSON.stringify([...new Set(merged.flatMap(section=>section.refs.map(ref=>ref.materialId)))]),summary:`审核并收录 ${incoming.length} 个知识点，保留已有内容与编辑`}});
    }
    return tx.materialStudyTask.update({where:{id:row.id},data:{content:JSON.stringify({...content,sections:completed}),revision:{increment:1}}});
  });
  return getMaterialStudyTask(input.courseId,saved.id);
}
export { NotebookConflict };
