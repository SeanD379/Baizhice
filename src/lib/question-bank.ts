import type { OriginalQuestion, OriginalKind, OriginalSource } from './question-bank-types';
export type SourcePart = { page: number; text: string; method?: string; warnings?: string[]; blocks?: { type: string; assetPath?: string; marker?: string }[] };
export type DocumentGroup<T extends SourcePart = SourcePart> = { id: string; title: string; kind: 'question' | 'content'; pages: T[]; text: string };
const clean = (text: string) => text.replace(/[\u200b-\u200f\ufeff]/g, '').replace(/&#10;/g, '\n').replace(/&#13;/g, '\n').trim();
export const originalQuestionShape=(question:OriginalQuestion)=>JSON.stringify({id:question.id,materialId:question.materialId,number:question.number,section:question.section,kind:question.kind,prompt:question.prompt,context:question.context,options:question.options,sources:question.sources,media:question.media??[],origin:question.origin});
export function headingKind(text: string): OriginalKind | null {
  const heading = text.replace(/^[一二三四五六七八九十\d]+[、.．]\s*/, '');
  if (heading.length > 85) return null;
  if (/^(?:单项选择|单选|选择题)/.test(heading)) return 'single';
  if (/^(?:多项选择|多选|不定项选择|不确定选择)/.test(heading)) return 'multiple';
  if (/^(?:判断题|判断正误)/.test(heading)) return 'judge';
  if (/^填空题/.test(heading)) return 'fill';
  if (/^名词解释/.test(heading)) return 'term';
  if (/^(?:简答题|问答题)/.test(heading)) return 'short';
  if (/^(?:计算题|证明题|解答题)/.test(heading)) return 'calculation';
  if (/^(?:写作|作文|论述题)/.test(heading)) return 'essay';
  return null;
}
function questionStart(text: string, kind: OriginalKind | null) {
  const match=text.match(/^\s*(?:例题?|练习)?\s*(\d(?:\s*\d){0,2})\s*[.．、:：)）]\s*(\S.*)$/) ?? (kind === 'term' ? text.match(/^\s*(\d{1,3})\s*([\u4e00-\u9fff].+)$/) : null);
  if(match)match[1]=match[1].replace(/\s/g,'');
  return match;
}
const contentHeading=(text:string)=>text.length<120&&(/^(?:第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+[、.．]|[（(]\s*[一二三四五六七八九十]+\s*[）)])/.test(text)||/^[^。！？?]{0,70}(?:讲义|课堂笔记|复习笔记|知识内容|知识梳理|知识点讲解)\s*$/.test(text));
const lectureExercise=(text:string,options:{label:string;text:string}[])=>options.length>1||/^(?:例题?|练习)\s*\d|[?？]|^(?:请|试|求证|求出|证明)/.test(text);
function optionsOf(text: string) {
  const matches = [...text.matchAll(/(?:^|[\s\u3000])([A-HＡ-Ｈ])\s*[.．、:：)）]\s*/g)];
  return matches.map((match, index) => ({ label: match[1].normalize('NFKC'), text: clean(text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length)) }));
}
function contentKind(prompt: string, options: { label: string; text: string }[], sectionKind: OriginalKind | null): OriginalKind {
  if (sectionKind) return sectionKind;
  if (options.length > 1) return /所有|多项|多选|哪些|不定项|不确定选择/.test(prompt) ? 'multiple' : 'single';
  if (/判断|正确还是错误|[（(]\s*[）)]\s*$/.test(prompt) && !/填写|填入/.test(prompt)) return 'judge';
  if (/名词解释|解释.{0,10}含义/.test(prompt)) return 'term';
  if (/计算|求出|求证|^证明/.test(prompt)) return 'calculation';
  if (/作文|写作|不少于.{0,6}字/.test(prompt)) return 'essay';
  if (/填空|填入|空缺部分|_{2,}/.test(prompt)) return 'fill';
  if (/简述|简答|说明|分析|为什么|如何|[?？]/.test(prompt)) return 'short';
  return 'unknown';
}
export function parseOriginalQuestions(material: { id: string; name: string; mime?: string; hash?: string }, pages: SourcePart[]): OriginalQuestion[] {
  const questions: OriginalQuestion[] = [];
  type Chunk={page:SourcePart;text:string;sourceText?:string};
  let section = '', sectionKind: OriginalKind | null = null, sectionIndex = 0, context = '', before:Chunk[]=[], contextSources:Chunk[]=[],collectingContext=false, answerSection = false, instructions=false, exerciseSection=false, lecture=false;
  let current: { number: string; chunks:Chunk[]; contextSources:Chunk[]; context: string; section: string; kind: OriginalKind | null; sectionIndex: number; exercise:boolean;lecture:boolean;example:boolean } | null = null;
  const location:OriginalSource['location']=/\.(docx|txt)$/i.test(material.name)?'paragraph':/\.pptx$/i.test(material.name)?'slide':'page';
  function addSources(sources:OriginalSource[],chunks:Chunk[]) {
    for(const {page,text,sourceText} of chunks){
      const snippet=sourceText??text;
      const existing=sources.find(source=>source.page===page.page);
      if(existing)existing.snippet=(existing.snippet+'\n'+snippet).slice(0,1600);
      else sources.push({page:page.page,name:material.name,snippet:snippet.slice(0,1600),location});
    }
  }
  function finish() {
    if (!current) return;
    const full = current.chunks.map(chunk => chunk.text).join('\n');
    const inlineAnswer = full.match(/(?:【\s*(?:参考)?答案\s*】|(?:参考)?答案\s*[:：])\s*([\s\S]*)/);
    const inlineExplanation=inlineAnswer?.[1].match(/(?:【\s*解析\s*】|解析\s*[:：])\s*([\s\S]+)/);
    const answerText=inlineAnswer?clean(inlineExplanation?inlineAnswer[1].slice(0,inlineExplanation.index):inlineAnswer[1]):'';
    const body = inlineAnswer ? full.slice(0, inlineAnswer.index).trim() : full;
    const options = optionsOf(body);
    const firstOption = body.search(/(?:^|[\s\u3000])[A-HＡ-Ｈ]\s*[.．、:：)）]\s*/);
    const prompt = clean(firstOption >= 0 ? body.slice(0, firstOption) : body);
    const inferredKind = contentKind(prompt, options, current.kind);
    const kind = inferredKind==='unknown'&&current.exercise?'short':inferredKind;
    // Ordinary numbered lecture paragraphs are content, rather than automatically becoming exercises.
    if ((kind !== 'unknown' || /请选择|下列|回答|作答/.test(prompt))&&(!current.lecture||current.exercise||current.example||lectureExercise(prompt,options))) {
      const sources: OriginalSource[] = [];
      addSources(sources,[...current.contextSources,...current.chunks]);
      const media = [...current.contextSources,...current.chunks].flatMap(({ page }) => (page.blocks ?? []).filter(block => block.type === 'image' && block.assetPath).map(block => ({ url: `/api/materials/${encodeURIComponent(material.id)}/assets?path=${encodeURIComponent(block.assetPath!)}`, label: block.marker ?? '原文图片' })));
      const explanation=clean(inlineExplanation?.[1]??'');
      questions.push({ id: `${material.id}:s${current.sectionIndex}:p${current.chunks[0].page.page}:q${current.number}`, materialId: material.id, number: current.number, section: current.section, kind, prompt, context: current.context, options, sources, topics: [], answer: answerText, answerSource: answerText ? 'original' : 'none', explanation, criteria: [], warnings: kind === 'unknown' ? ['请确认这道题的题型。'] : [], origin: 'original', ...(media.length ? { media: [...new Map(media.map(item => [item.url, item])).values()] } : {}) });
      if(answerText){const answerSources:OriginalSource[]=[];addSources(answerSources,current.chunks.filter(chunk=>/答案|解析/.test(chunk.text)));questions.at(-1)!.answerRefs=(answerSources.length?answerSources:sources).map(source=>({...source,materialId:material.id,sourceHash:material.hash}));}
    }
    current = null;
  }
  let answerRange:number[]|null=null,answerKind:OriginalKind|null=null,answerSubpoints=false;
  const answerSubpointNumbers=new Set<string>(),ambiguousAnswerNumbers=new Set<string>();
  let answer:{number:string;chunks:Chunk[];kind:OriginalKind|null}|null=null;
  function finishAnswer(){
    if(!answer)return;
    const targets=questions.filter(question=>question.number===answer!.number&&(!answer!.kind||question.kind===answer!.kind));
    const full=clean(answer.chunks.map(chunk=>chunk.text).join('\n'));
    if(ambiguousAnswerNumbers.size){
      for(const question of questions.filter(question=>ambiguousAnswerNumbers.has(question.number)&&(!answer!.kind||question.kind===answer!.kind))){
        question.warnings.push('答案编号层级不明确，请对照原文核对后补充答案。');
        addSources(question.sources,answer.chunks);
      }
    }
    else if(targets.length===1&&full){
      const explanation=full.match(/(?:【\s*解析\s*】|解析\s*[:：])\s*([\s\S]+)/);
      targets[0].answer=clean(explanation?full.slice(0,explanation.index):full);
      targets[0].answerSource='original';
      const answerSources:OriginalSource[]=[];addSources(answerSources,answer.chunks);targets[0].answerRefs=answerSources.map(source=>({...source,materialId:material.id,sourceHash:material.hash}));
      if(explanation)targets[0].explanation=clean(explanation[1]);
      addSources(targets[0].sources,answer.chunks);
    }
    answer=null;answerSubpoints=false;answerSubpointNumbers.clear();ambiguousAnswerNumbers.clear();
  }
  const lines:Chunk[]=pages.flatMap(page=>clean(page.text).split(/\r?\n/).map(text=>({page,text:clean(text)})).filter(chunk=>chunk.text));
  for(let index=0;index<lines.length;index++){
    const {page}=lines[index];let text=lines[index].text;
    // Page numbers and repeated PDF headers carry no question or answer content.
    if(/^第\s*\d+\s*页\s*[/／]\s*共\s*\d+\s*页$/.test(text)||/^学科\s*网[（(]/.test(text))continue;
    const range=text.match(/^【\s*(\d+)\s*(?:[~～—–-]\s*(\d+))?\s*题答案\s*】$/);
    if(range){finish();finishAnswer();answerSection=true;answerSubpoints=false;answerRange=Array.from({length:Math.min(1000,Number(range[2]??range[1])-Number(range[1])+1)},(_,i)=>Number(range[1])+i);continue;}
    const answerLabel=text.match(/^(?:第\s*(\d+)\s*题\s*(?:参考)?答案|【\s*第\s*(\d+)\s*题\s*(?:参考)?答案\s*】)\s*[:：]?\s*(.*)$/);
    if(answerLabel){finish();finishAnswer();answerSection=true;answerSubpoints=false;const number=answerLabel[1]??answerLabel[2];answerRange=[Number(number)];answer={number,kind:answerKind,chunks:[{page,text:answerLabel[3]}]};continue;}
    if (/^(?:参考答案(?:及解析|与解析)?|答案与解析|答案解析|答案)\s*$/.test(text)) {
      if(current?.example&&!answerSection){current.chunks.push({page,text:'答案：',sourceText:text});continue;}
      finish();finishAnswer();answerSection = true;answerRange=null;answerSubpoints=false; continue;
    }
    const heading = headingKind(text);
    if(answerSection){
      if(heading||contentHeading(text)){finishAnswer();answerKind=heading;answerSubpoints=false;continue;}
      const marked=/^【\s*(?:参考)?答案\s*】/.test(text);
      if(marked)answerSubpoints=false;
      const value=clean(text.replace(/^【\s*(?:参考)?答案\s*】/,''));
      const matches=[...value.matchAll(/(?:^|\s)(\d(?:\s*\d){0,2})\s*[.．、:：]\s*/g)];
      const accepted:RegExpMatchArray[]=[];
      for(const match of matches){
        const number=match[1].replace(/\s/g,'');
        // A restarted number list belongs to this subjective answer until a clear answer label.
        if(!marked&&answer&&value.slice(0,match.index).trim()===''&&Number(number)<=Number(answer.number))answerSubpoints=true;
        if(answerSubpoints){
          if(value.slice(0,match.index).trim()===''){
            if(answerSubpointNumbers.has(number)){ambiguousAnswerNumbers.add(answer!.number);ambiguousAnswerNumbers.add(number);}
            answerSubpointNumbers.add(number);
          }
          continue;
        }
        if(!questions.some(question=>question.number===number)||answerRange&&!answerRange.includes(Number(number)))continue;
        const previous=accepted.at(-1);
        if(!previous?value.slice(0,match.index).trim()==='':/^(?:[A-H]+|[√×]|正确|错误|对|错)$/i.test(value.slice(previous.index!+previous[0].length,match.index).trim()))accepted.push(match);
      }
      if(accepted.length)for(let i=0;i<accepted.length;i++){
        const match=accepted[i];finishAnswer();
        answer={number:match[1].replace(/\s/g,''),kind:answerKind,chunks:[{page,text:clean(value.slice(match.index!+match[0].length,accepted[i+1]?.index??value.length))}]};
      }
      else if(marked&&answerRange?.length===1){finishAnswer();answer={number:String(answerRange[0]),kind:answerKind,chunks:[{page,text:value}]};}
      else if(answer)answer.chunks.push({page,text:value});
      continue;
    }
    if (heading) {
      finish(); section = text; sectionKind = heading;
      sectionIndex++; context = ''; before = [];contextSources=[];collectingContext=false;instructions=false;exerciseSection=true;lecture=false;
      continue;
    }
    if(contentHeading(text)&&(!collectingContext||/本题共\s*\d+\s*小题/.test(text))){finish();section=text;sectionKind=null;sectionIndex++;context='';before=[];contextSources=[];collectingContext=false;instructions=false;exerciseSection=/本题共\s*\d+\s*小题/.test(text);lecture=!exerciseSection;continue;}
    if(/^(?:注意事项|考生须知|答题说明)\s*[:：]?$/.test(text)){finish();instructions=true;continue;}
    if (/^(?:阅读(?:下面|以下|下列|文字)|根据下面|根据以下|材料[一二三四五六七八九十]|【材料)/.test(text)) {
      const append=collectingContext&&!current;finish();before=append?[...before,{page,text}]:[{page,text}];context='';collectingContext=true;instructions=false;exerciseSection=true;lecture=false;continue;
    }
    if(instructions)continue;
    const numbering:Chunk[]=[lines[index]];
    if(/^\d(?:\s*\d){0,2}\s*[.．、:：)）]?$/.test(text)){
      if(!/[.．、:：)）]$/.test(text)&&/^[.．、:：)）]/.test(lines[index+1]?.text??'')){numbering.push(lines[++index]);text+=lines[index].text;}
      if(/[.．、:：)）]$/.test(text)&&lines[index+1]){numbering.push(lines[++index]);text+=lines[index].text;}
    }
    const start = questionStart(text, sectionKind);
    if (start) {
      finish();
      if (collectingContext&&before.length) { context = before.map(chunk=>chunk.text).join('\n');contextSources=before;before = [];collectingContext=false; }
      current = { number: start[1], chunks: numbering.length>1?numbering:[{ page, text: clean(start[2]) }], contextSources,context, section, kind: sectionKind, sectionIndex,exercise:exerciseSection,lecture,example:/^(?:例题?|练习)\s*\d/.test(text) };
      if(numbering.length>1)current.chunks=current.chunks.map((chunk,i)=>({...chunk,sourceText:chunk.text,text:i===numbering.length-1?clean(start[2]):''}));
    } else if (current) current.chunks.push({ page, text });
    else if(collectingContext)before.push({page,text});
  }
  finish();
  finishAnswer();
  return questions;
}
export function groupDocumentPages<T extends SourcePart>(pages: T[]): DocumentGroup<T>[] {
  const nonempty = pages.filter(page => page.text.trim());
  // Real PDF pages and slides already include their full content; do not duplicate a page for each question.
  if (nonempty.some(page => page.method && !['docx-text', 'text'].includes(page.method))) return nonempty.map(page => ({ id: `source-${page.page}`, title: page.method === 'pptx-text' ? `第 ${page.page} 张幻灯片` : `第 ${page.page} 页`, kind: 'content', pages: [page], text: page.text }));
  const groups: DocumentGroup<T>[] = [];
  let kind: OriginalKind | null = null,lecture=false;
  const lectureCandidates=new Map<DocumentGroup<T>,RegExpMatchArray>();
  for (const page of nonempty) {
    const text = clean(page.text), heading = headingKind(text), start = questionStart(text, kind);
    if (heading) {kind = heading;lecture=false;}
    const isHeading=contentHeading(text);if(isHeading&&!heading){kind=null;lecture=!/本题共\s*\d+\s*小题/.test(text);}
    if(/^(?:阅读(?:下面|以下|下列|文字)|根据下面|根据以下)/.test(text))lecture=false;
    const isQuestion=!!start&&(kind!==null||contentKind(start[2],optionsOf(text),null)!=='unknown')&&(!lecture||lectureExercise(text,optionsOf(text)));
    if (heading || isHeading || start || !groups.length || (groups.at(-1)!.kind==='content'&&groups.at(-1)!.text.length + text.length > 6000)) {
      const group:DocumentGroup<T>={ id: `group-${page.page}`, title: isQuestion ? `第 ${start![1]} 题 · ${clean(start![2]).slice(0, 45)}` : text.slice(0, 60), kind: isQuestion ? 'question' : 'content', pages: [page], text: page.text };
      groups.push(group);if(lecture&&start)lectureCandidates.set(group,start);
    }
    else { const group = groups.at(-1)!; group.pages.push(page); group.text += '\n' + page.text; }
  }
  for(const [group,start] of lectureCandidates)if(group.kind==='content'&&optionsOf(group.text).length>1){group.kind='question';group.title=`第 ${start[1]} 题 · ${clean(start[2]).slice(0,45)}`;}
  return groups;
}
export function gradeOriginal(question: OriginalQuestion, answer: string): boolean | null {
  if (!question.answer.trim() || !answer.trim() || ['term', 'short', 'calculation', 'essay', 'unknown'].includes(question.kind)) return null;
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s/g, '');
  if (question.kind === 'single' || question.kind === 'multiple') {
    const labels = (value: string) => {const text=normalize(value).toUpperCase().replace(/[,，、;；]/g,'');return /^[A-H]+$/.test(text)&&[...text].every(label=>question.options.some(option=>option.label===label))?[...new Set(text)].sort().join(''):'';};
    const target = labels(question.answer), chosen = labels(answer);
    if (!target || !chosen || (question.kind === 'single' && target.length !== 1)) return null;
    return target === chosen;
  }
  if (question.kind === 'judge') {
    const judgement = (value: string) => /^(正确|对|是|√|true)$/i.test(normalize(value)) ? true : /^(错误|错|否|×|false)$/i.test(normalize(value)) ? false : null;
    const target = judgement(question.answer), chosen = judgement(answer);
    return target === null || chosen === null ? null : target === chosen;
  }
  if (normalize(question.answer) === normalize(answer)) return true;
  const numeric = (value: string) => { const text = normalize(value); if (!/^[+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)?$/.test(text)) return NaN; const values = text.split('/').map(Number); return values.length === 2 ? values[0] / values[1] : values[0]; };
  const actual = numeric(answer), expected = numeric(question.answer);
  return Number.isFinite(actual) && Number.isFinite(expected) ? Math.abs(actual - expected) <= 1e-9 : null;
}
