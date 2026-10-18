import type { Material, Section } from './types';

export const sampleInfo = {
  conditional: { name: '条件概率与乘法公式.pdf', chapter: '条件概率', status: 'ready' },
  independence: { name: '事件的独立性.pdf', chapter: '事件独立性', status: 'ready' },
  note: { name: '课堂笔记 · 冲突测试样例.pdf', chapter: '事件独立性', status: 'review' },
  exercises: { name: '条件概率 · 配套练习与解析.pdf', chapter: '综合练习', status: 'ready' },
} as const;
export type SampleKey = keyof typeof sampleInfo;
export const chineseDemoCourseId = 'high-school-chinese';
export const chineseExamInfo = {
  '2023-new-i': { name: '2023 高考语文·新课标Ⅰ卷（网络整理版）.pdf', chapter: '历年套卷', source: 'https://static.ltdcdn.com/uploadfilev2/file/0/534/647/2024-03/17108961629859.pdf' },
  '2024-new-i': { name: '2024 高考语文·新课标Ⅰ卷（含参考答案）.pdf', chapter: '历年套卷', source: 'https://static-gkcx.gaokao.cn/upload/zhenti/20240612/1718157275_1581.pdf' },
  '2024-new-ii': { name: '2024 高考语文·新课标Ⅱ卷.pdf', chapter: '历年套卷', source: 'https://down.jiaoyuwu.com/m00/1a/d5/7717046b7687dad50fb7f70cbff68f9c.pdf' },
} as const;
export type ChineseExamKey = keyof typeof chineseExamInfo;
export const mathSampleKeys = ['conditional', 'independence', 'note', 'exercises'] as const;
export const topicsForCourse = (courseId: string, materials: Pick<Material, 'fixture'>[] = []) =>
  courseId === 'probability' || (courseId !== chineseDemoCourseId && materials.some(m => m.fixture === 'conditional' || m.fixture === 'independence'))
    ? ['conditional', 'independence'] : [];

export function generateSections(materials: Material[], ids: string[], topics: string[]): Section[] {
  const selected = materials.filter(m => ids.includes(m.id) && !m.excluded);
  if (selected.some(m => m.status === 'review')) throw new Error('请先处理或排除存在冲突的笔记。');
  if (selected.some(m => !m.fixture || m.status !== 'ready')) throw new Error('所选资料尚未接入真实 AI 处理。请使用演示资料生成。');
  if (selected.length !== new Set(ids).size) throw new Error('资料范围已变化，请重新选择。');
  const result: Section[] = [];
  const source = (m: Material, snippet: string) => [{ materialId: m.id, name: m.name, page: 1, snippet }];
  const conditional = selected.find(m => m.fixture === 'conditional');
  const independence = selected.find(m => m.fixture === 'independence');
  const exercises = selected.find(m => m.fixture === 'exercises');
  if (topics.includes('conditional') && conditional) result.push({
    id: 'conditional', title: '条件概率与乘法公式',
    body: '条件概率描述在已知事件 $A$ 发生的前提下，事件 $B$ 发生的概率。\n\n$$P(B\\mid A)=\\frac{P(A\\cap B)}{P(A)},\\quad P(A)>0$$\n\n将定义改写，得到乘法公式：\n\n$$P(A\\cap B)=P(A)P(B\\mid A)$$\n\n**易错提醒**：先明确条件事件；$P(B\\mid A)$ 与 $P(A\\mid B)$ 通常不能互换。',
    refs: source(conditional, '只有 P(A)>0 时，下面的比值才有定义。P(B|A) = P(A∩B) / P(A)。'),
  });
  if (topics.includes('independence') && independence) result.push({
    id: 'independence', title: '事件的独立性',
    body: '判断两个事件是否独立，要比较联合概率与两个事件概率的乘积。\n\n$$P(A\\cap B)=P(A)P(B)$$\n\n当 $P(A)>0$ 时，独立性也可以写为 $P(B\\mid A)=P(B)$。\n\n**独立不等于互斥**：当两个事件的概率都大于零时，互斥事件不独立。判断时不能省略这两个非零条件。',
    refs: source(independence, '当 P(A)>0 且 P(B)>0 时，互斥事件不独立。不要省略这两个非零条件。'),
  });
  if (exercises && topics.includes('conditional')) result.push({ id: 'exercise-conditional', title: '例题 · 先缩小条件范围', body: '学习小组有 10 人，6 人学过概率论，其中 3 人完成了复习提纲。已知选中的同学学过概率论，他完成提纲的概率是多少？\n\n**解析**：条件范围是学过概率论的 6 人，所求概率为 $3/6=1/2$。', refs: source(exercises, '条件事件是“学过概率论”，其范围内有 6 人，满足目标事件的有 3 人。因此所求概率为 3/6=1/2。') });
  if (exercises && topics.includes('independence')) result.push({ id: 'exercise-independence', title: '例题 · 用定义验证独立性', body: '已知 $P(A)=0.4$、$P(B)=0.5$、$P(A\\cap B)=0.2$，判断两个事件是否独立。\n\n**解析**：$0.4\\times0.5=0.2$，联合概率等于概率的乘积，因此两个事件独立。', refs: source(exercises, 'P(A)P(B)=0.4×0.5=0.2，与 P(A∩B) 相等，因此 A 与 B 相互独立。') });
  if (!result.length) throw new Error('该范围没有可生成的演示知识点，请选择对应资料和章节。');
  return result;
}

export function mergeAdditions(existing: Section[], candidates: Section[], chosen: string[]): Section[] {
  const known = new Set(existing.map(s => s.id));
  const additions = candidates.filter(s => chosen.includes(s.id) && !known.has(s.id));
  if (!additions.length) throw new Error('没有可采用的新增内容。');
  return [...existing, ...additions];
}

export function applyEdits(existing: Section[], edits: { id: string; body: string }[]): Section[] {
  if (edits.some(e => !existing.some(s => s.id === e.id))) throw new Error('待修改的段落不存在。');
  if (!edits.some(e => existing.find(s => s.id === e.id)?.body !== e.body)) throw new Error('内容没有变化，无需创建新版本。');
  return existing.map(section => {
    const edit = edits.find(e => e.id === section.id);
    return edit && edit.body !== section.body ? { ...section, body: edit.body, edited: true, needsReview: true } : section;
  });
}
