'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleAlert, ExternalLink, FileText, FolderOpen, History, LayoutDashboard, ListChecks, LoaderCircle, Menu, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PencilLine, Plus, RotateCw, Search, ShieldCheck, Trash2, TrendingUp, Upload, X } from 'lucide-react';
import { Button } from './ui/button';
import { ThemeToggle } from './ui-theme';
import { Modal } from './ui/modal';
import { Markdown } from './markdown';
import { ExtractedContent } from './extracted-content';
import { MaterialStudyReader } from './material-study-reader';
import { OriginalFilePreview } from './original-file-preview';
import { GenerationDialog } from './generation-dialog';
import { ChapterField } from './chapter-field';
import { PasteMaterial } from './paste-material';
import { documentLabel, sourceLocation, supportedFormats } from '@/lib/document-labels';
import { aiAssistantText } from '@/lib/ai-assistant';
import type { Extraction } from '@/lib/extraction-types';
import { LearningHome } from './learning-home';
import { LearningAnalytics } from './learning-analytics';
import { LibraryExplorer } from './library-explorer';
import { LooseLeafNotebook } from './loose-leaf-notebook';
import { PracticeHub, PracticeHubProvider, practiceTitles } from './practice-hub';
import { PracticeActivityPage } from './practice-activity';
import { PracticeStudyProvider } from './practice-study-context';
import { parsePracticeLocation, practiceLocation, type PracticeLocation, type PracticeBackAction } from '@/lib/practice-hub';
import { NotebookProvider } from './notebook-context';
import { useNotebookStore } from './use-notebook';
import { contentOriginLabel, markdownDocument, referenceOriginLabel, richMarkdown } from '@/lib/notebook';
import { chineseDemoCourseId, chineseExamInfo, generateSections, mathSampleKeys, sampleInfo, topicsForCourse } from '@/lib/content';
import { examReadingGuide } from '@/lib/exam-reading';
import type { ConversationSummary, Course, Material, Reference, Section, Version, Workspace } from '@/lib/types';

const PdfPreview = dynamic(() => import('./pdf-preview'), { ssr: false, loading: () => <div className="preview-loading"><LoaderCircle className="spin" size={20} />正在载入预览</div> });
type View = 'home' | 'analytics' | 'library' | 'outline' | 'practice' | 'exam' | 'versions';
type PracticeSection = PracticeLocation['section'];
type UploadJob = { file: File; state: 'waiting' | 'saving' | 'done' | 'error'; message: string };
type InboxItem = { id: string; name: string; mime: string; size: number; source: string; courseId: string | null; createdAt: string };
type Panel = { material: Material; reference?: Reference; previewPage?: number };
const viewNames = { home: 'AI 学习', analytics: '学习分析', library: '我的资料', outline: '我的活页笔记', practice: '练习中心', exam: '套卷练习', versions: '版本记录' };
const sidebarPreferenceKey = 'lms.app-shell-5.navigation-collapsed';
const conflictReasons = [
  ['reference_incorrect', '参考资料可能有误'], ['outdated', '参考资料已过时'], ['missing_context', '缺少上下文'],
  ['teacher_review', '需要教师确认'], ['review_later', '稍后再核对'],
] as const;
const conflictReasonLabel = (value: string | null | undefined) => conflictReasons.find(([key]) => key === value)?.[1] ?? value;
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function CourseCover({ title, seed }: { title: string; seed: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const width = 180, height = 242, scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const palettes = [
      { start: '#3f5b3d', end: '#78915f', accent: '#dce9c8' },
      { start: '#45526f', end: '#8796b6', accent: '#e4e8f4' },
      { start: '#765747', end: '#b38e6b', accent: '#f5e7d4' },
      { start: '#4c6665', end: '#83a7a0', accent: '#dcefea' },
    ];
    const hash = Array.from(seed).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
    const palette = palettes[hash % palettes.length];
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette.start);
    gradient.addColorStop(1, palette.end);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 0.18;
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(width - 23, 36, 61, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.22;
    context.beginPath();
    context.arc(15, height - 24, 78, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    context.fillStyle = palette.accent;
    context.fillRect(20, 22, 40, 4);
    context.fillRect(20, height - 30, 28, 3);
    context.font = '600 10px "Microsoft YaHei", sans-serif';
    context.fillText('LEARNING NOTES', 20, 45);
    const characters = Array.from(title.trim() || '我的学习资料');
    const lines: string[] = [];
    for (let index = 0; index < characters.length; index += 7) lines.push(characters.slice(index, index + 7).join(''));
    context.fillStyle = '#fff';
    context.font = '600 24px "Microsoft YaHei", sans-serif';
    lines.slice(0, 3).forEach((line, index) => context.fillText(line, 20, 98 + index * 33));
    context.fillStyle = palette.accent;
    context.font = '11px "Microsoft YaHei", sans-serif';
    context.fillText('课程复习 · 个人资料', 20, height - 52);
  }, [seed, title]);
  return <canvas ref={canvasRef} className="course-book-cover" width={180} height={242} role="img" aria-label={`${title}封面`}/>;
}
function ReviewSourcePicker({ materials, selectedIds, purpose, onSelect, onContinue, onLibrary, onExam }: { materials: Material[]; selectedIds: string[]; purpose: '复习' | '练习'; onSelect: (ids: string[]) => void; onContinue: () => void; onLibrary: () => void; onExam: () => void }) {
  const notes = materials.filter(material => material.chapter !== '历年套卷' && !material.fixture);
  const usable = (material: Material) => !material.excluded && !material.conflictResolution && (material.status === 'extracted' || material.status === 'ready');
  const selectedCount = notes.filter(material => usable(material) && selectedIds.includes(material.id)).length;
  const examCount = materials.filter(material => material.chapter === '历年套卷').length;
  return <section className="review-source-picker" aria-label={`选择资料进行${purpose}`}>
    <div className="review-source-heading"><div><h2>选择我的资料</h2><p>{purpose === '练习' ? '先选资料整理知识点，核对内容与出处后再生成练习题。' : '选好资料后，再挑页码并核对识别文字。'}</p></div><span>已选 {selectedCount} 份</span></div>
    {notes.length ? <div className="review-source-list">{notes.map(material => <label key={material.id} className={!usable(material) ? 'is-unavailable' : ''}><input type="checkbox" checked={selectedIds.includes(material.id) && usable(material)} disabled={!usable(material)} onChange={event => onSelect(event.target.checked ? [...selectedIds, material.id] : selectedIds.filter(id => id !== material.id))}/><FileText size={17}/><span>{material.name}</span>{!usable(material) && <small>{material.excluded ? '已排除' : material.status === 'stored' ? '待提取文字' : '暂不可用'}</small>}</label>)}</div> : <p className="review-source-empty">这门课还没有可选的讲义或笔记。上传资料并提取文字后，就能在这里选择。</p>}
    <div className="review-source-footer"><Button variant="primary" disabled={!selectedCount} onClick={onContinue}>核对所选资料<ArrowRight size={16}/></Button><Button variant="ghost" onClick={onLibrary}>查看我的资料</Button>{examCount > 0 && <button type="button" className="review-source-exam" onClick={onExam}>{examCount} 份套卷可到「套卷练习」按原题作答</button>}</div>
  </section>;
}
async function api<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method, headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body) });
  const result = await response.json().catch(() => ({ error: '服务暂时不可用，请保留当前操作并重试。' }));
  if (!response.ok) throw new Error(result.error ?? '操作失败，请重试。');
  return result;
}

export default function Workbench() {
  const [workspace, setWorkspace] = useState<Workspace>({ courses: [], materials: [], versions: [] });
  const [courseId, setCourseId] = useState(chineseDemoCourseId), [view, setView] = useState<View>('home');
  const [practiceRoute, setPracticeRoute] = useState<PracticeLocation>({ section: 'overview', activity: null });
  const practiceSection = practiceRoute.section;
  const practiceLeave = useRef<(() => Promise<boolean>) | null>(null);
  const registerPracticeLeave = useCallback((flush: (() => Promise<boolean>) | null) => { practiceLeave.current = flush; }, []);
  const [practiceBackAction,setPracticeBackAction]=useState<PracticeBackAction|null>(null);
  const registerPracticeBackAction=useCallback((action:PracticeBackAction|null)=>setPracticeBackAction(action),[]);
  const navigationFlush = useRef<() => Promise<boolean>>(async () => true), currentUrl = useRef('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [desktopLibrary, setDesktopLibrary] = useState(false), [readerSettingsOpen, setReaderSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false), [historyQuery, setHistoryQuery] = useState('');
  const [initialLoading, setInitialLoading] = useState(true), [error, setError] = useState(''), [toast, setToast] = useState(''), [busy, setBusy] = useState('');
  const notebook = useNotebookStore(courseId, !initialLoading);
  const [panel, setPanel] = useState<Panel | null>(null), [mobileMenu, setMobileMenu] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false), [uploadTab, setUploadTab] = useState<'files' | 'samples'>('files'), [jobs, setJobs] = useState<UploadJob[]>([]), [dragging, setDragging] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]), [inboxErrors, setInboxErrors] = useState<Record<string, string>>({});
  const [importResults, setImportResults] = useState<{ name: string; message: string }[]>([]);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [reviewSourceIds, setReviewSourceIds] = useState<string[]>([]), [generationMaterialIds, setGenerationMaterialIds] = useState<string[] | null>(null), [generationFromPractice, setGenerationFromPractice] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false), [selected, setSelected] = useState<string[]>([]), [topics, setTopics] = useState<string[]>([]);
  const [conflictFeedbackOpen, setConflictFeedbackOpen] = useState(false), [conflictFeedbackReason, setConflictFeedbackReason] = useState(''), [conflictFeedbackNote, setConflictFeedbackNote] = useState('');
  const [createOpen, setCreateOpen] = useState(false), [courseName, setCourseName] = useState('');
  const [courseShelfOpen, setCourseShelfOpen] = useState(false), [profileOpen, setProfileOpen] = useState(false);
  const [historical, setHistorical] = useState<Version | null>(null);
  const [updateChosen, setUpdateChosen] = useState<string[]>([]);
  const [chatConversations, setChatConversations] = useState<ConversationSummary[]>([]), [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [newChatKey, setNewChatKey] = useState(0);
  const [conversationDialog, setConversationDialog] = useState<{ kind: 'rename' | 'delete'; conversation: ConversationSummary } | null>(null), [conversationTitle, setConversationTitle] = useState('');
  const [materialToDelete, setMaterialToDelete] = useState<Material | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), initialized = useRef(false), main = useRef<HTMLElement>(null);
  const course = workspace.courses.find(c => c.id === courseId);
  const materials = workspace.materials.filter(m => m.courseId === courseId), versions = workspace.versions.filter(v => v.courseId === courseId).sort((a,b) => b.number - a.number), latest = versions[0];
  const demoTopics = topicsForCourse(courseId, materials), mathDemo = demoTopics.includes('conditional');
  const panelGuide = panel ? examReadingGuide(panel.material) : null;
  const examGuideCard = panelGuide && <nav className="exam-quick-guide" aria-label="试卷内容导航"><strong>选择要读的部分</strong><p>点选后打开原卷对应页；下方的文字可按页展开。</p><div>{panelGuide.landmarks.map(item=><button key={item.label} type="button" onClick={()=>{setPanel(current=>current?{...current,previewPage:item.page,reference:undefined}:current);requestAnimationFrame(()=>document.querySelector('.inspector .preview-caption')?.scrollIntoView({behavior:'smooth',block:'start'}));}}>{item.label}<small>第 {item.page} 页</small></button>)}</div></nav>;
  const issues = materials.filter(m => m.status === 'review' && !m.excluded && !m.conflictResolution);
  const pausedConflicts = materials.filter(m => m.conflictResolution === 'paused');
  const ready = materials.filter(m => m.status === 'ready' && !m.excluded);
  const extracted = materials.filter(m => m.status === 'extracted' && !m.excluded);
  const excluded = materials.filter(m => m.excluded);
  let additions: Section[] = [];
  if (latest && ready.length) { try { additions = generateSections(ready, ready.map(m => m.id), demoTopics).filter(s => !latest.sections.some(old => old.id === s.id)); } catch {} }
  const reload = useCallback(async () => { const next = await api<Workspace>('/api/workspace'); setWorkspace(next); setError(''); return next; }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), initialView = params.get('view');
    if (initialView === 'exam') { setView('practice'); window.history.replaceState(null, '', practiceLocation(params.get('course') || courseId, parsePracticeLocation(params))); }
    else if (initialView && initialView in viewNames) setView(initialView as View);
    setPracticeRoute(parsePracticeLocation(params)); setActiveConversationId(params.get('chat'));
    currentUrl.current = window.location.pathname + window.location.search;
    void reload().then(next => { const id = params.get('course'); if (id && next.courses.some(c => c.id === id)) setCourseId(id); initialized.current = true; }).catch(e => setError(e.message)).finally(() => setInitialLoading(false));
    const pop = async () => {
      const previous = currentUrl.current;
      if (!await navigationFlush.current()) { window.history.pushState(null, '', previous); return; }
      const next = new URLSearchParams(window.location.search), nextView = next.get('view');
      setView(nextView === 'exam' ? 'practice' : nextView && nextView in viewNames ? nextView as View : 'home');
      setPracticeRoute(parsePracticeLocation(next)); if (next.get('course')) setCourseId(next.get('course')!);
      setActiveConversationId(next.get('chat')); setPanel(null); setMobileMenu(false); currentUrl.current = window.location.pathname + window.location.search;
      main.current?.focus({ preventScroll: true });
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [reload]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(sidebarPreferenceKey);
      if (saved === 'true' || saved === 'false') setSidebarCollapsed(saved === 'true');
      else setSidebarCollapsed(true);
    } catch { setSidebarCollapsed(true); }
  }, []);
  useEffect(() => { setHistoryOpen(false); setHistoryQuery(''); }, [courseId]);
  useEffect(() => {
    const update = () => setDesktopLibrary(window.innerWidth >= 1024);
    update(); window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => { setReaderSettingsOpen(false); }, [panel?.material.id, view]);
  useEffect(() => { setReviewSourceIds([]); }, [courseId]);
  useEffect(() => { if (initialized.current && view === 'home') { const params = new URLSearchParams(window.location.search); if (activeConversationId) params.set('chat', activeConversationId); else params.delete('chat'); window.history.replaceState(null, '', `?${params.toString()}`); currentUrl.current = window.location.pathname + window.location.search; } }, [activeConversationId, view]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]') && !document.querySelector('.sidebar-open')) { if (view === 'library' && desktopLibrary) setReaderSettingsOpen(false); else setPanel(null); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [view, desktopLibrary]);
  useEffect(() => {
    if (!mobileMenu) return;
    const drawer = document.getElementById('shell-navigation');
    const opener = document.querySelector<HTMLButtonElement>('button[aria-label="展开课程导航"]');
    drawer?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      if (event.key === 'Escape') { event.preventDefault(); setMobileMenu(false); opener?.focus(); }
      if (event.key !== 'Tab' || !drawer) return;
      const controls = [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]')].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mobileMenu]);
  useEffect(() => { setConflictFeedbackOpen(false); setConflictFeedbackReason(''); setConflictFeedbackNote(''); }, [panel?.material.id]);

  async function flushNavigation() {
    if (view === 'practice' && practiceLeave.current && !await practiceLeave.current()) { setError('当前作答保存失败，请在答题区重试保存后再离开；答案仍保留在本页。'); return false; }
    if (notebook.data && !await notebook.flush()) { setError('笔记尚未保存，请重试保存后再离开。'); return false; }
    return true;
  }
  navigationFlush.current = flushNavigation;
  async function navigate(next: View, id = courseId, newConversation = false) {
    if (!await flushNavigation()) return false;
    if (id !== courseId) { setChatConversations([]); setActiveConversationId(null); }
    if (newConversation) { setActiveConversationId(null); setNewChatKey(current => current + 1); }
    const normalized = next === 'exam' ? 'practice' : next, route: PracticeLocation = { section: next === 'exam' ? 'papers' : 'overview', activity: null };
    const params = new URLSearchParams({ course: id, view: normalized }); if (activeConversationId && normalized === 'home' && !newConversation) params.set('chat', activeConversationId);
    const url = normalized === 'practice' ? practiceLocation(id, route) : '/?' + params.toString();
    window.history.pushState(null, '', url); currentUrl.current = url;
    setPracticeRoute(route); setView(normalized); setCourseId(id); setPanel(null); setMobileMenu(false); setHistoryOpen(false); setUpdateChosen([]); if (main.current) main.current.scrollTop = 0; main.current?.focus({preventScroll:true});
    return true;
  }
  async function openPracticeLocation(route: PracticeLocation) {
    if (!await flushNavigation()) return;
    const url = practiceLocation(courseId, route); window.history.pushState(null, '', url); currentUrl.current = url;
    setView('practice'); setPracticeRoute(route); setPanel(null); setError(''); if (main.current) main.current.scrollTop = 0; main.current?.focus({preventScroll:true});
  }
  function choosePracticeSection(section: PracticeSection) { void openPracticeLocation({ section, activity: null }); }
  function toggleSidebar() {
    setSidebarCollapsed(current => {
      const next = !current;
      try { window.localStorage.setItem(sidebarPreferenceKey, String(next)); } catch { /* The layout still works when browser storage is unavailable. */ }
      return next;
    });
  }
  function openRenameConversation(conversation: ConversationSummary) {
    setConversationTitle(conversation.title);
    setConversationDialog({ kind: 'rename', conversation });
  }
  function openDeleteConversation(conversation: ConversationSummary) {
    setConversationDialog({ kind: 'delete', conversation });
  }
  async function submitConversationDialog() {
    if (!conversationDialog) return;
    const { conversation, kind } = conversationDialog;
    if (kind === 'rename') {
      const title = conversationTitle.trim();
      if (!title || title === conversation.title) {
        setConversationDialog(null);
        return;
      }
      await run('重命名对话', async () => {
        const result = await api<{ conversations: ConversationSummary[] }>('/api/chat', { courseId, conversationId: conversation.id, title }, 'PATCH');
        setChatConversations(result.conversations);
        setConversationDialog(null);
      });
      return;
    }
    await run('删除对话', async () => {
      const response = await fetch(`/api/chat?courseId=${encodeURIComponent(courseId)}&conversationId=${encodeURIComponent(conversation.id)}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({ error: '对话删除失败，请重试。' }));
      if (!response.ok) throw new Error(result.error ?? '对话删除失败，请重试。');
      setChatConversations(result.conversations);
      if (activeConversationId === conversation.id) setActiveConversationId(null);
      setConversationDialog(null);
    });
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return; setBusy(label); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试。'); } finally { setBusy(''); }
  }
  function openUpload(tab: 'files' | 'samples') { setUploadTab(tab); setUploadOpen(true); if (tab === 'files') { setImportResults([]); void reloadInbox(); } }
  async function reloadInbox() { try { setInbox(await api<InboxItem[]>('/api/import-inbox')); } catch (e) { setError(e instanceof Error ? e.message : '收件箱暂时无法读取。'); } }
  async function importSamples(group: 'core' | 'supplement') {
    await run('导入样例', async () => { const result = await api<{ message: string }>('/api/workspace', { action: 'import-samples', courseId, group }); await reload(); setToast(result.message); setUploadOpen(false); if(group==='core') navigate('home'); });
  }
  function queueFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    void run('暂存资料', async () => {
      setJobs(prev => [...prev, ...selected.map(file => ({ file, state: 'waiting' as const, message: '' }))]);
      for (const file of selected) {
        const update = (patch: Partial<UploadJob>) => setJobs(prev => prev.map(job => job.file === file ? { ...job, ...patch } : job));
        update({ state: 'saving', message: '正在存入收件箱' });
        try {
          if (!file.size || file.size > 100 * 1024 * 1024) throw new Error('文件为空或超过 100 MB，请重新选择。');
          const form = new FormData(); form.append('courseId', courseId); form.append('file', file);
          await api<InboxItem>('/api/import-inbox', form);
          setJobs(prev => prev.filter(job => job.file !== file));
        } catch (e) { update({ state: 'error', message: e instanceof Error ? e.message : '暂存失败，请重试。' }); }
      }
      await reloadInbox();
    });
  }
  async function assignInbox(id: string, targetCourseId: string) {
    await run('保存课程归属', async () => { const item = await api<InboxItem>(`/api/import-inbox/${id}`, { courseId: targetCourseId }, 'PATCH'); setInbox(prev => prev.map(current => current.id === id ? item : current)); });
  }
  async function assignAllInbox(targetCourseId: string) {
    await run('保存课程归属', async () => {
      for (const item of inbox) if (item.courseId !== targetCourseId) await api<InboxItem>(`/api/import-inbox/${item.id}`, { courseId: targetCourseId }, 'PATCH');
      await reloadInbox();
    });
  }
  async function discardInbox(id: string) {
    await run('移除暂存文件', async () => { await api(`/api/import-inbox/${id}`, {}, 'DELETE'); setInbox(prev => prev.filter(item => item.id !== id)); });
  }
  async function uploadFiles() {
    await run('导入资料', async () => {
      setImportResults([]);
      for (const item of inbox) {
        setInboxErrors(prev => ({ ...prev, [item.id]: '正在导入' }));
        try {
          const result = await api<{ duplicate: boolean; material: Material }>(`/api/import-inbox/${item.id}`, {});
          setInbox(prev => prev.filter(current => current.id !== item.id));
          let message = result.duplicate ? '课程中已有相同文件，未重复保存' : '已加入课程资料';
          if (!result.duplicate && !result.material.fixture) {
            setInboxErrors(prev => ({ ...prev, [item.id]: '正在本机提取文字' }));
            try { await api<{result:Extraction}>(`/api/materials/${result.material.id}/extraction`, {}); }
            catch { message = '已加入课程资料，文字识别未完成；可在资料详情重试'; }
          }
          setImportResults(prev => [...prev, { name: item.name, message }]);
          setInboxErrors(prev => { const next = { ...prev }; delete next[item.id]; return next; });
        } catch (e) { setInboxErrors(prev => ({ ...prev, [item.id]: e instanceof Error ? e.message : '导入失败，请重试。' })); }
      }
      await reload(); await reloadInbox(); setToast('收件箱处理完成。未导入的文件仍保留，可稍后重试。');
    });
  }
  async function toggleExclude(material: Material) {
    await run('保存选择', async () => { const next = await api<Material>(`/api/materials/${material.id}`, { excluded: !material.excluded }, 'PATCH'); await reload(); setPanel(p => p?.material.id === next.id ? { ...p, material: next } : p); setSelected(ids => ids.filter(id => id !== material.id)); setToast(next.excluded ? '已暂时移出提纲与练习的生成范围，原文件未删除或改写。' : '已重新纳入生成范围。待确认的内容仍需处理。'); });
  }
  async function deleteMaterial() {
    if (!materialToDelete) return;
    const material = materialToDelete;
    await run('删除资料', async () => {
      const result = await api<{ cleanupWarning: boolean }>(`/api/materials/${encodeURIComponent(material.id)}`, {}, 'DELETE');
      await reload();
      setPanel(current => current?.material.id === material.id ? null : current);
      setSelected(ids => ids.filter(id => id !== material.id));
      setMaterialToDelete(null);
      setToast(result.cleanupWarning ? '资料已从课程删除，但部分本机文件未能清理，请检查项目数据目录。' : '资料已删除，已保存的复习版本与作答仍保留。');
    });
  }
  async function resolveConflict(material: Material, action: 'accept-reference' | 'pause-conflict' | 'reopen-conflict') {
    await run('保存冲突处理结果', async () => {
      const body = action === 'pause-conflict' ? { action, reason: conflictFeedbackReason, note: conflictFeedbackNote } : { action };
      const next = await api<Material>(`/api/materials/${material.id}`, body, 'PATCH');
      await reload();
      setPanel(current => current?.material.id === material.id ? { ...current, material: next } : current);
      setConflictFeedbackOpen(false);
      setToast(action === 'accept-reference' ? '已采纳参考结论。后续复习内容将使用参考资料，原始笔记未修改。' : action === 'pause-conflict' ? '已提交反馈。这份冲突资料已暂停用于生成提纲和练习。' : '已恢复为待确认状态，请重新核对这处冲突。');
    });
  }
  function showRange() { if (extracted.length) { setGenerationMaterialIds(null); setGenerationFromPractice(false); setGenerationOpen(true); return; } setSelected(ready.map(m => m.id)); setTopics(demoTopics); setRangeOpen(true); }
  function openSelectedSources(fromPractice: boolean) {
    const ids = reviewSourceIds.filter(id => materials.some(material => material.id === id && !material.excluded && !material.conflictResolution && (material.status === 'extracted' || material.status === 'ready')));
    if (!ids.length) return;
    setGenerationMaterialIds(ids);
    setGenerationFromPractice(fromPractice);
    setGenerationOpen(true);
  }
  async function generate() {
    await run('正在准备演示提纲', async () => { await api('/api/versions', { action: 'generate', courseId, expectedVersionId: latest?.id ?? null, materialIds: selected, topics }); await reload(); setRangeOpen(false); navigate('outline'); setToast('演示提纲已生成并保存在本机，每段内容可查看依据。'); });
  }
  function openReference(ref: Reference) { const material = materials.find(m => m.id === ref.materialId); if (!material) { setError('引用原文件不可访问。'); return; } setHistorical(null); setPanel({ material, reference: ref }); }
  function exportOutline(version: Version) {
    const text = `# ${course?.name} · ${version.title}\n\n版本 ${version.number} · ${version.sections.some(s=>s.generation)?'含 AI 助手 生成内容':'演示模式'}\n\n` + version.sections.map(s => `## ${s.title}\n\n${s.body}\n\n${s.generation ? `${contentOriginLabel(s.generation)}${s.edited ? ' · 个人修订' : ''}\n\n` : ''}${s.needsReview ? '注意：本段内容及引用待核对。\n\n' : ''}${referenceOriginLabel(s.generation)}：${s.refs.map(r => `${r.name} ${sourceLocation(r.name,r.page)}`).join('；')}`).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `复习提纲-v${version.number}.md`; a.click(); URL.revokeObjectURL(url);
  }
  function status(m: Material) { return m.conflictResolution === 'paused' ? '冲突暂停' : m.conflictResolution === 'accepted_reference' ? '已采纳参考结论' : m.excluded ? '已排除' : m.status === 'review' ? '待确认' : m.status === 'ready' ? '演示可用' : m.status === 'extracted' ? '文字已提取 · 待整理' : '已保存 · 待提取'; }

  const historyConversations = chatConversations.filter(conversation => conversation.title.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const readerTitle = view === 'home' ? chatConversations.find(conversation => conversation.id === activeConversationId)?.title ?? viewNames.home : view === 'library' && panel ? panel.material.name : viewNames[view];

  // Recreated from the public App Shell 5 preview; the licensed Pro block is not installed.
  function renderNotebook(initialPageId?: string) { return <LooseLeafNotebook key={`${courseId}:${initialPageId??''}`} initialPageId={initialPageId} store={notebook} courseName={course?.name ?? '当前课程'} onGenerate={() => { void notebook.flush('整理资料前保存'); setGenerationMaterialIds(materials.map(material => material.id)); setGenerationFromPractice(view==='practice'); setGenerationOpen(true); }} onReference={openReference} onLegacyVersions={() => navigate('versions')} onConfirmSource={async (origin, body) => {
          if (!origin.sectionId) return;
          const current = await reload(), currentVersion = current.versions.filter(version => version.courseId === courseId).sort((a, b) => b.number - a.number)[0];
          const section = currentVersion?.sections.find(item => item.id === origin.sectionId);
          if (section) { const changed = !!body && body !== richMarkdown(markdownDocument(section.body)); let expectedVersionId = currentVersion.id; if (changed) { const updated = await api<Version>('/api/versions', { action: 'save', courseId, expectedVersionId, edits: [{ id: section.id, body }] }); expectedVersionId = updated.id; } if (section.needsReview || changed) { await api('/api/versions', { action: 'confirm-refs', courseId, expectedVersionId, sectionId: section.id }); await reload(); } }
        }}/>; }
  return <PracticeHubProvider courseId={courseId} preload={view === 'practice' && !initialLoading}><NotebookProvider store={notebook}><div data-view={view} className={`app-shell app-shell-5 ${panel ? 'has-inspector' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#main">跳到主要内容</a>
    {mobileMenu && <button className="nav-backdrop" aria-label="关闭课程导航" onClick={() => setMobileMenu(false)} />}
    <aside id="shell-navigation" aria-label="学习导航" className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <div className="brand" title="百知册 · 把零散资料，学成完整知识。"><span className="brand-mark" aria-hidden="true"><img className="brand-logo" src="/brand/baizhice-symbol-blue.png" alt="" width={42} height={42}/></span><div><b>百知册</b><span>把零散资料，学成完整知识。</span></div></div>
      <p className="nav-label">AI 学习</p>
      <nav aria-label="AI 学习"><button className={`nav-item ${view==='home'?'active':''}`} aria-label="新对话" title="新对话" onClick={() => navigate('home', courseId, true)} aria-current={view==='home'?'page':undefined}><LayoutDashboard size={16}/><span>新对话</span></button></nav>
      <p className="nav-label content-nav-label">学习内容</p>
      <nav aria-label="学习内容">{([['analytics',TrendingUp],['library',FolderOpen],['outline',BookOpen],['practice',ListChecks]] as const).map(([id,Icon]) => <button key={id} className={`nav-item ${view===id?'active':''}`} aria-label={viewNames[id]} title={viewNames[id]} onClick={() => navigate(id)} aria-current={view===id?'page':undefined}><Icon size={16}/><span>{viewNames[id]}</span>{id==='library' && materials.length>0 && <small>{materials.length}</small>}</button>)}</nav>
      <div className="sidebar-course"><button className="course-select-trigger" type="button" aria-label="展开课程书架" title={course?.name ?? '切换课程'} aria-haspopup="dialog" aria-expanded={courseShelfOpen} onClick={() => setCourseShelfOpen(true)} disabled={!!busy}><BookOpen size={16}/><span>{course?.name ?? '选择一门课程'}</span><ChevronDown size={14}/></button><Button className="sidebar-add-course" size="icon" variant="ghost" aria-label="添加课程" title="添加课程" onClick={() => setCreateOpen(true)}><Plus size={15}/></Button></div>
      <ThemeToggle/>
      <Button className="sidebar-toggle" variant="ghost" aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={toggleSidebar}>{sidebarCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}<span>{sidebarCollapsed ? '展开侧栏' : '收起侧栏'}</span></Button>
      <button className="profile" type="button" title="我的学习空间" onClick={() => setProfileOpen(true)} aria-label="打开我的学习空间"><span>我</span><div><b>我的学习空间</b><small>查看学习概况</small></div><ShieldCheck size={17}/></button>
    </aside>
    <div className="workspace">
      <header className="topbar"><Button variant="ghost" size="icon" className="mobile-menu" aria-label="展开课程导航" aria-expanded={mobileMenu} aria-controls="shell-navigation" onClick={() => setMobileMenu(true)}><Menu size={18}/></Button><h1 title={readerTitle}>{readerTitle}</h1><div className="shell-reader-actions"><span title={course?.name}>{course?.name}</span><Button variant="ghost" size="icon" aria-label="切换课程" title="切换课程" onClick={() => setCourseShelfOpen(true)}><BookOpen size={15}/></Button><Button variant="ghost" size="icon" aria-label="上传学习资料" title="上传资料" onClick={() => openUpload('files')}><Upload size={15}/></Button>{view === 'library' && panel && <Button variant="ghost" size="icon" aria-label="关闭原文面板" title="关闭资料" onClick={() => setPanel(null)}><X size={16}/></Button>}</div></header>
      <div className={`workarea ${view === 'library' && desktopLibrary ? 'library-master-detail' : ''}`}>
      <main id="main" ref={main} tabIndex={-1} className={`content-view view-${view}`}>
        {error && <div className="error-banner" role="alert"><CircleAlert size={18}/><span>{error}</span><Button size="sm" variant="ghost" onClick={() => void run('刷新数据',async()=>{await reload();})}>刷新数据</Button><Button size="icon" variant="ghost" aria-label="关闭错误提示" onClick={()=>setError('')}><X size={16}/></Button></div>}
        {initialLoading ? <div className="workspace-loading"><LoaderCircle className="spin" size={27}/><p>正在打开你的学习空间</p></div> : <>
        {view === 'home' && <LearningHome key={`${courseId}-${newChatKey}`} courseId={courseId} initialConversationId={activeConversationId} conversations={chatConversations} onConversationsChange={setChatConversations} onSelectConversation={setActiveConversationId} historyOpen={historyOpen} onOpenHistory={() => { setHistoryQuery(''); setHistoryOpen(true); }}/>}
        {view === 'analytics' && <LearningAnalytics key={courseId} courseId={courseId} onOpenPractice={route => void openPracticeLocation(route)} onLibrary={() => void navigate('library')} onOutline={() => void navigate('outline')} onVersions={() => void navigate('versions')}/>}
        {view === 'practice' && <PracticeStudyProvider key={courseId} courseId={courseId}><div className={`practice-center ${practiceSection === 'overview' ? 'practice-center-overview' : 'practice-center-subpage'}`}>
          {practiceSection === 'overview' ? <>
            <div className="practice-cover-heading"><h1>练习中心</h1></div>
            <nav className="practice-center-options" aria-label="练习中心分区">{([
              ['knowledge', ListChecks, '知识点巩固', '从已核对资料出题，按知识点练习', '围绕知识点'],
              ['mistakes', RotateCw, '错题复盘', '回看知识点与套卷中的待巩固题', '回看与重练'],
              ['papers', FileText, '套卷练习', '打开原卷作答，按题号保存记录', '还原原卷'],
            ] as const).map(([section, Icon, title, description, label]) => <button type="button" key={section} className={`practice-cover-card practice-cover-${section}`} onClick={() => choosePracticeSection(section)}>
              <span className="practice-cover-top"><span className="practice-cover-label"><Icon size={16}/>{label}</span><span className="practice-cover-arrow"><ArrowRight size={18}/></span></span>
              <span className="practice-cover-art" aria-hidden="true">{section === 'knowledge' ? <span className="practice-knowledge-art"><span className="practice-knowledge-sheet practice-knowledge-sheet-back"/><span className="practice-knowledge-sheet practice-knowledge-sheet-front"><i/><i/><i/></span><span className="practice-knowledge-check"><Check size={20}/></span></span> : section === 'mistakes' ? <span className="practice-mistakes-art"><span className="practice-mistakes-note"><i/><i/><i/></span><span className="practice-mistakes-repeat"><RotateCw size={36} strokeWidth={1.7}/></span></span> : <span className="practice-papers-art"><span className="practice-papers-sheet"><i/><i/><i/><i/></span><span className="practice-papers-pencil"><PencilLine size={25}/></span></span>}</span>
              <span className="practice-cover-copy"><strong>{title}</strong><small>{description}</small></span>
            </button>)}</nav>
          </> : <>
            <nav className={`practice-subpage-nav hub-${practiceSection}`} aria-label="练习中心返回路径"><Button variant="ghost" className="practice-back-button" onClick={() => practiceBackAction ? practiceBackAction.onClick() : practiceRoute.fromFile && (practiceRoute.materialId || practiceRoute.pageId) ? void openPracticeLocation({ section: practiceSection, activity: 'file', materialId: practiceRoute.materialId, pageId: practiceRoute.pageId }) : choosePracticeSection(practiceRoute.activity ? practiceSection : 'overview')}><ArrowLeft size={16}/>{practiceBackAction?.label??('返回'+(practiceRoute.fromFile ? practiceSection === 'mistakes' ? '资料错题' : '资料内容' : practiceRoute.activity ? practiceTitles[practiceSection] : '练习中心'))}</Button></nav>
            {practiceRoute.activity ? <div className={`practice-activity hub-${practiceSection}`}><PracticeActivityPage key={`${courseId}:${JSON.stringify(practiceRoute)}`} courseId={courseId} section={practiceSection} location={practiceRoute} materials={materials} version={latest} onOpen={openPracticeLocation} onUpload={()=>openUpload('files')} onMaterial={material=>setPanel({material})} onSource={openReference} onReload={reload} registerLeave={registerPracticeLeave} registerBackAction={registerPracticeBackAction} notebook={renderNotebook(practiceRoute.pageId)} knowledgeSources={<ReviewSourcePicker materials={materials} selectedIds={reviewSourceIds} purpose="练习" onSelect={setReviewSourceIds} onContinue={()=>openSelectedSources(true)} onLibrary={()=>navigate('library')} onExam={()=>choosePracticeSection('papers')}/>}/></div> : <PracticeHub courseId={courseId} section={practiceSection} onOpen={route=>void openPracticeLocation(route)}/>}
          </>}
        </div></PracticeStudyProvider>}
        {view === 'library' && <>
          <div className="page-heading library-page-heading">
            <div><h1>{course?.name}</h1><p>{materials.length} 份资料</p></div>
            <div className="library-heading-actions">
              <Button variant="primary" onClick={() => openUpload('files')} disabled={!!busy}><Plus size={17}/>上传资料</Button>
            </div>
          </div>
          {issues.length > 0 && <div className="issue-banner"><span className="issue-icon"><CircleAlert size={21}/></span><div><b>{issues.length} 份笔记需要你确认</b><p>有一处说法与参考讲义不同，先核对，再决定是否用于复习。</p></div><Button variant="ghost" onClick={() => setPanel({material:issues[0]})}>查看疑点<ArrowRight size={16}/></Button></div>}
          <LibraryExplorer
            key={courseId}
            masterDetail={desktopLibrary}
            selectedMaterialId={panel?.material.id}
            onClearSelection={() => setPanel(null)}
            courseId={courseId}
            materials={materials}
            folders={workspace.folders ?? []}
            mathDemo={mathDemo}
            onOpen={material => setPanel({ material })}
            onDelete={material => { setError(''); setMaterialToDelete(material); }}
            onUpload={() => openUpload('files')}
            onSamples={() => openUpload('samples')}
            onReload={reload}
            onMoved={moved => {
              setWorkspace(current => ({ ...current, materials: current.materials.map(material => moved.find(item => item.id === material.id) ?? material) }));
              setPanel(current => { const material = moved.find(item => item.id === current?.material.id); return current && material ? { ...current, material } : current; });
            }}
            onToast={setToast}
            status={status}
          />
        </>}
        {view === 'outline' && renderNotebook()}
        {view==='versions' && <>
          <div className="page-heading"><div><h1>每次积累，都有迹可循</h1><p>新资料补进来，你的理解留下来。</p></div>{mathDemo&&<Button disabled={!!busy} onClick={()=>void importSamples('supplement')}><Plus size={16}/>补充例题样例</Button>}</div>
          {!latest ? <div className="empty-state"><div className="empty-icon"><History size={32}/></div><h3>还没有复习版本</h3><p>生成第一份提纲后，每次保存和更新都会在这里留下记录。</p><Button onClick={()=>navigate('outline')}>准备复习提纲<ArrowRight size={16}/></Button></div> : <>
            {additions.length>0 ? <div className="update-card"><div className="update-heading"><span className="update-icon"><FileText size={21}/></span><div><h2>有 {additions.length} 项新内容待你选择</h2><p>只添加你选择的内容，现有段落与个人修改全部保留。</p></div><span className="tag">待审阅更新</span></div><div className="comparison"><div className="existing-column"><span className="comparison-label">当前版本 · V{latest.number}</span>{latest.sections.map(s=><div key={s.id} className="existing-item"><Check size={15}/><span>{s.title}</span>{s.edited&&<small>个人编辑</small>}</div>)}<p><ShieldCheck size={15}/>以上内容保持原样</p></div><div className="new-column"><span className="comparison-label">可新增的内容</span>{additions.map(s=><label key={s.id} className={`addition-choice ${updateChosen.includes(s.id)?'checked':''}`}><input type="checkbox" checked={updateChosen.includes(s.id)} onChange={e=>setUpdateChosen(v=>e.target.checked?[...v,s.id]:v.filter(id=>id!==s.id))}/><div><b>{s.title}</b><Markdown text={s.body}/><small>{s.refs[0]?.name} · 第 1 页</small></div></label>)}</div></div><div className="update-footer"><span>已选择 {updateChosen.filter(id=>additions.some(s=>s.id===id)).length} 项 · 保存后生成新版本</span><Button variant="primary" disabled={!!busy || !updateChosen.some(id=>additions.some(s=>s.id===id))} onClick={()=>void run('保存更新',async()=>{await api('/api/versions',{action:'update',courseId,expectedVersionId:latest.id,chosenIds:updateChosen});await reload();setUpdateChosen([]);setToast('已保存新版本，原有编辑和历史版本均已保留。');})}>采用所选更新<ArrowRight size={16}/></Button></div></div> : <div className="up-to-date"><span><CheckCheck size={24}/></span><div><h3>当前提纲已同步所采用的内容</h3><p>可在复习材料中从真实资料补充内容，或补充例题样例体验演示更新。</p></div></div>}
            <div className="version-section-heading"><h2>版本记录</h2><span>{versions.length} 个版本 · 每次保存均保留快照</span></div><div className="version-list">{versions.map((v,i)=><div className="version-row" key={v.id}><div className={`version-timeline ${i===0?'current':''}`}><History size={17}/></div><div><h3>版本 {v.number}{i===0&&<span className="status-badge status-ready">当前版本</span>}</h3><p>{aiAssistantText(v.summary)}</p><small>{dateLabel(v.createdAt)} · {v.sections.length} 个内容段落 · {v.sourceIds.length} 份依据</small></div><Button onClick={()=>setHistorical(v)}>查看<ChevronRight size={14}/></Button></div>)}</div>
          </>}
        </>}
        </>}
      </main>
      {view === 'library' && desktopLibrary && !panel && !initialLoading && <section className="library-reader library-reader-empty" aria-label="资料阅读"><div><FileText size={34}/><h2>选择一份资料开始阅读</h2><p>从左侧选择资料，或上传新的讲义、笔记与套卷。</p></div></section>}
      {panel && <aside className={`inspector ${view === 'practice' && panel.reference ? 'practice-source-inspector' : ''} ${panelGuide ? 'inspector-exam' : ''} ${view === 'library' && desktopLibrary ? 'library-reader' : ''}`} aria-label="资料与原文对照">
        <div className="inspector-header">{view === 'library' && desktopLibrary ? <>
          <h2 id="library-reader-title" title={panel.material.name}>{panel.material.name}</h2>
          <div className="library-reader-actions">
            <a href={`/api/files/${panel.material.id}`} target="_blank" rel="noreferrer" aria-label="打开原文件" title="打开原文件"><ExternalLink size={19}/></a>
            <a href={`/api/files/${panel.material.id}`} download={panel.material.name} aria-label="下载原文件" title="下载原文件"><ArrowDownToLine size={19}/></a>
            <Button variant="ghost" size="icon" aria-label="删除当前资料" title="删除资料" disabled={!!busy} onClick={() => { setError(''); setMaterialToDelete(panel.material); }}><Trash2 size={19}/></Button>
            <Button variant="ghost" size="icon" aria-label="资料设置" title="资料设置" aria-expanded={readerSettingsOpen} aria-controls="library-reader-settings" onClick={() => setReaderSettingsOpen(current => !current)}><MoreHorizontal size={19}/></Button>
          </div>
        </> : <><span><FileText size={17}/>{panel.reference ? '原文对照' : '资料详情'}</span><Button variant="ghost" size="icon" aria-label="关闭原文面板" onClick={() => setPanel(null)}><X size={18}/></Button></>}</div>
        <div className={`inspector-content ${view === 'library' && desktopLibrary ? 'material-reader-content' : ''}`}><div id={view === 'library' && desktopLibrary ? 'library-reader-settings' : undefined} className={view === 'library' && desktopLibrary ? 'library-reader-settings' : undefined} hidden={view === 'practice' && !!panel.reference || view === 'library' && desktopLibrary && !readerSettingsOpen}>{view === 'library' && desktopLibrary ? <div className="library-reader-metadata"><div><strong>{panel.material.chapter || '未分类'}</strong><span>{documentLabel(panel.material.mime)} · {sizeLabel(panel.material.size)} · {status(panel.material)}</span><p className="source-origin">{panel.material.origin.startsWith('高考真题 · 来源：') ? <a href={panel.material.origin.slice('高考真题 · 来源：'.length)} target="_blank" rel="noreferrer">高考真题 · 查看原始来源</a> : panel.material.origin}</p></div><time dateTime={panel.material.createdAt}>{dateLabel(panel.material.createdAt)}</time></div> : <><div className="inspector-title"><span className={`file-icon ${panel.material.status === 'review' ? 'file-note' : ''}`}><FileText size={22}/><small>{documentLabel(panel.material.mime)}</small></span><div><h2>{panel.material.name}</h2><p>{sizeLabel(panel.material.size)} · {status(panel.material)}</p></div></div><p className="source-origin">{panel.material.origin.startsWith('高考真题 · 来源：') ? <a href={panel.material.origin.slice('高考真题 · 来源：'.length)} target="_blank" rel="noreferrer">查看原始来源</a> : panel.material.origin}</p></>}
        {panel.material.name===chineseExamInfo['2023-new-i'].name&&<p className="exam-source-note">这份网络整理版把现代文阅读总分误排为 36 分；各题分值合计为 35 分。文件不含参考答案。</p>}{panel.material.name===chineseExamInfo['2024-new-ii'].name&&<p className="exam-source-note">这份试卷文件只含题目，不含参考答案。</p>}{examGuideCard}
        {panel.reference && <div className="reference-context"><span><BookOpen size={13}/>本段引用依据 · {sourceLocation(panel.reference.name,panel.reference.page)}</span><p>{panel.reference.snippet}</p><small>生成内容可能引用核对后文字，请同时对照原文件。</small></div>}
        {panel.material.status==='review' && !panel.material.conflictResolution && <div className="inspector-issue"><span className="issue-label"><CircleAlert size={15}/>发现一处内容冲突</span><h3>{'互斥是否意味着独立？'}</h3><div className="conflict-quote"><small>你的笔记</small><p>{'“只要两个事件互斥，它们就一定相互独立。”'}</p></div><div className="conflict-reference"><small>参考资料</small><p>{'两个事件的概率都大于零时，互斥事件不独立。'}</p><button onClick={()=>{const m=materials.find(m=>m.fixture===('independence'));if(m)setPanel({material:m});else setToast('请先导入独立性参考讲义。');}}>{'查看独立性参考讲义'}<ArrowRight size={13}/></button></div><p className="muted small">采纳后，后续提纲和练习使用参考结论；你的原始笔记保持不变。</p><div className="conflict-actions"><Button disabled={!!busy} onClick={()=>void resolveConflict(panel.material,'accept-reference')}>采纳参考结论</Button><Button variant="secondary" disabled={!!busy} onClick={()=>setConflictFeedbackOpen(true)}>暂不采纳</Button></div>{conflictFeedbackOpen && <div className="conflict-feedback"><b>为什么暂不采纳？</b><div className="conflict-reasons">{conflictReasons.map(([value,label])=><label key={value}><input type="radio" name="conflict-reason" value={value} checked={conflictFeedbackReason===value} onChange={()=>setConflictFeedbackReason(value)}/><span>{label}</span></label>)}</div><label className="conflict-note">补充说明（选填）<textarea maxLength={500} value={conflictFeedbackNote} onChange={event=>setConflictFeedbackNote(event.target.value)} /></label><p>提交后，这份冲突资料将暂停用于生成提纲和练习；其他无冲突资料不受影响。完成核对后可随时恢复。</p><Button disabled={!conflictFeedbackReason||!!busy} onClick={()=>void resolveConflict(panel.material,'pause-conflict')}>提交反馈并暂停使用</Button></div>}</div>}
        {panel.material.conflictResolution==='paused' && <div className="inspector-issue conflict-result"><span className="issue-label"><CircleAlert size={15}/>因内容冲突已暂停</span><h3>这份资料暂不参与生成</h3><p>暂停原因：{conflictReasonLabel(panel.material.conflictFeedbackReason)}</p>{panel.material.conflictFeedbackNote&&<p className="conflict-result-note">{panel.material.conflictFeedbackNote}</p>}<p className="muted small">提纲和练习会继续使用其他无冲突资料。原始笔记未删除或改写。</p><Button variant="secondary" disabled={!!busy} onClick={()=>void resolveConflict(panel.material,'reopen-conflict')}>重新核对</Button></div>}
        {panel.material.conflictResolution==='accepted_reference' && <div className="inspector-issue conflict-result conflict-accepted"><span className="issue-label"><Check size={15}/>已采纳参考结论</span><h3>后续复习将使用参考资料</h3><p>后续复习内容将采用参考结论，原始笔记未修改。</p><Button variant="secondary" disabled={!!busy} onClick={()=>void resolveConflict(panel.material,'reopen-conflict')}>重新核对</Button></div>}
        <div>
        {!panel.material.fixture && <div className="stored-note"><CircleAlert size={16}/><p>文件保存在当前学习空间。提取后可在复习材料中核对原页文字，再选择发送给 AI 助手 整理。</p></div>}
        <div className="source-controls"><ChapterField key={panel.material.id+'-'+panel.material.chapter} chapter={panel.material.chapter} chapters={materials.map(m=>m.chapter)} disabled={!!busy} onSave={chapter=>run('保存章节',async()=>{const m=await api<Material>(`/api/materials/${panel.material.id}`,{chapter},'PATCH');await reload();setPanel(p=>p?{...p,material:m}:p);setToast('章节归属已保存。');})}/>{panel.material.status!=='review' && <Button variant="ghost" size="sm" disabled={!!busy} onClick={()=>void toggleExclude(panel.material)}>{panel.material.excluded?'恢复纳入范围':'从生成范围排除'}</Button>}</div>
        </div>
        </div>{view === 'library' && desktopLibrary ? <MaterialStudyReader key={courseId} courseId={courseId} material={panel.material} materials={materials} reference={panel.reference} initialPage={panel.reference?.location==='paragraph'||panel.reference?.location==='image'?1:panel.reference?.page??panel.previewPage??1} notebook={notebook} onReference={openReference} onReload={reload} onNotebook={pageId=>{try{localStorage.setItem(`lms.notebook.position.${courseId}`,`${pageId}:0`);}catch{/* Default reading location is still usable. */}navigate('outline');}} onPractice={(materialId,section='knowledge')=>{void openPracticeLocation({section,activity:section==='mistakes'?'mistakes':'sources',materialId});}}/> : view === 'practice' && panel.reference ? <div className="practice-source-preview"><h2>{panel.material.name}</h2><div className="preview-caption"><span>原始文件 · {sourceLocation(panel.reference.name,panel.reference.page)}</span><a href={`/api/files/${panel.material.id}`} target="_blank" rel="noreferrer"><ExternalLink size={13}/>打开原文件</a></div><OriginalFilePreview key={`${panel.material.id}:${panel.reference.page}:${panel.reference.snippet}`} material={panel.material} initialPage={panel.reference.location==='paragraph'||panel.reference.location==='image'?1:panel.reference.page} studyAnnotations={{mode:'browse',focusAnchor:{kind:panel.reference.location==='image'?'region':'text',page:panel.reference.location==='paragraph'||panel.reference.location==='image'?undefined:panel.reference.page,displayPage:panel.reference.anchor?.displayPage,quote:panel.reference.anchor?.quote??panel.reference.snippet,prefix:panel.reference.anchor?.prefix??'',suffix:panel.reference.anchor?.suffix??'',rects:panel.reference.anchor?.rects??[]}}}/></div> : <><ExtractedContent key={panel.material.id} readingMode={view === 'library' && desktopLibrary} material={panel.material} initialPage={panel.reference?.page??panel.previewPage??1} onComplete={async()=>{const next=await reload();setPanel(p=>p?{...p,material:next.materials.find(m=>m.id===p.material.id)??p.material}:p);}} onViewPage={page=>{setPanel(p=>p?{...p,previewPage:page,reference:undefined}:p);requestAnimationFrame(()=>document.querySelector('.inspector .preview-caption')?.scrollIntoView({behavior:'smooth',block:'start'}));}}/>
        <div className="preview-caption"><span>原始文件</span><a href={`/api/files/${panel.material.id}`} target="_blank" rel="noreferrer"><ArrowDownToLine size={13}/>打开原文件</a></div>{panel.material.mime==='application/pdf' ? <PdfPreview key={`${panel.material.id}-${panel.reference?.page??panel.previewPage??1}`} name={panel.material.name} url={`/api/files/${panel.material.id}`} initialPage={panel.reference?.page??panel.previewPage??1} landmarks={panelGuide?.landmarks}/> : panel.material.mime.startsWith('image/') ? <div className="image-preview"><img src={`/api/files/${panel.material.id}`} alt={panel.material.name} onError={e=>{e.currentTarget.alt='图片无法显示，请打开原文件检查。';}}/></div> : <p className="stored-note">上方显示按原始顺序提取的文字。Office 排版、图片和复杂公式请下载原文件对照；Word 与 TXT 的段号不代表打印页码。</p>}
        <p className="preview-footnote">原文件与导入记录保留。演示结果不代表实际模型识别质量。</p></>}
      </div></aside>}
      </div>
    </div>

    {generationOpen&&<GenerationDialog courseId={courseId} expectedVersionId={latest?.id??null} materialIds={generationMaterialIds} notebook={notebook} onClose={()=>setGenerationOpen(false)} onSaved={async()=>{await reload();await notebook.reload();setGenerationOpen(false);if(generationFromPractice)void openPracticeLocation({section:'knowledge',activity:'organize'});else void navigate('outline');setToast(generationFromPractice?'已保存复习材料。请先核对段落和引用，再到练习中心的知识点巩固出题。':'已采用所选内容并保存为新版本，请逐段核对内容及引用。');}}/>}<Modal error={error} open={uploadOpen} onOpenChange={value=>{if(!busy)setUploadOpen(value);}} title="导入收件箱" description={`先暂存文件，再确认所属课程。支持 ${supportedFormats}，每份 100 MB。`}>
      <div className="import-course-context"><BookOpen size={16}/><span>新文件默认归入：{course?.name}</span><small>每份文件都可单独改课程</small></div><div className="modal-tabs"><button aria-pressed={uploadTab==='files'} className={uploadTab==='files'?'selected':''} onClick={()=>{setUploadTab('files');void reloadInbox();}} disabled={!!busy}>上传我的文件</button><button aria-pressed={uploadTab==='samples'} className={uploadTab==='samples'?'selected':''} onClick={()=>setUploadTab('samples')} disabled={!!busy}><FileText size={14}/>{mathDemo?'中文演示资料':'高考真题资料'}</button></div>
      {uploadTab==='files' ? <><div className={`dropzone ${dragging?'dragging':''}`} onDragOver={e=>{e.preventDefault();if(!busy)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!busy)queueFiles(e.dataTransfer.files);}}><span><Upload size={27}/></span><h3>把资料拖到这里</h3><p>{supportedFormats} · 每份不超过 100 MB</p><Button disabled={!!busy} onClick={()=>fileInput.current?.click()}>选择本机文件</Button><input ref={fileInput} type="file" aria-label="选择上传资料" accept=".pdf,.png,.jpg,.jpeg,.docx,.pptx,.txt" multiple hidden onChange={e=>{if(e.target.files)queueFiles(e.target.files);e.target.value='';}}/></div>
        <PasteMaterial disabled={!!busy} onAdd={file=>queueFiles([file])}/>{jobs.length>0 && <div className="upload-queue">{jobs.map((job,i)=><div key={i} className={`upload-item ${job.state==='error'?'upload-error':''}`}><FileText size={19}/><div><b>{job.file.name}</b><small>{job.message || sizeLabel(job.file.size)}</small></div>{job.state==='saving'?<LoaderCircle size={17} className="spin"/>:<><Button variant="ghost" size="icon" disabled={!!busy} aria-label={`重试暂存${job.file.name}`} onClick={()=>{setJobs(v=>v.filter((_,j)=>i!==j));queueFiles([job.file]);}}><Upload size={15}/></Button><Button variant="ghost" size="icon" disabled={!!busy} aria-label={`移除${job.file.name}`} onClick={()=>setJobs(v=>v.filter((_,j)=>i!==j))}><X size={15}/></Button></>}</div>)}</div>}
        {inbox.length>0 && <div className="inbox-list"><div className="inbox-heading"><b>待确认 · {inbox.length} 份</b><label>全部归入 <select aria-label="全部文件归属课程" value="" disabled={!!busy} onChange={e=>void assignAllInbox(e.target.value)}><option value="" disabled>选择课程</option>{workspace.courses.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>{inbox.map(item=><div className="inbox-row" key={item.id}><FileText size={19}/><div className="inbox-file"><b>{item.name}</b><small>{sizeLabel(item.size)} · {item.source} · {inboxErrors[item.id] || '已暂存，尚未进入资料库'}</small></div><select aria-label={`${item.name}所属课程`} value={item.courseId ?? ''} disabled={!!busy} onChange={e=>void assignInbox(item.id,e.target.value)}><option value="" disabled>选择课程</option>{workspace.courses.map(course=><option key={course.id} value={course.id}>{course.name}</option>)}</select><Button variant="ghost" size="icon" disabled={!!busy} aria-label={`移除暂存文件${item.name}`} onClick={()=>void discardInbox(item.id)}><X size={15}/></Button></div>)}</div>}
        {importResults.length>0 && <div className="inbox-results" aria-live="polite">{importResults.map((result,index)=><div key={`${result.name}-${index}`}><Check size={14}/><span>{result.name}：{result.message}</span></div>)}</div>}
        <div className="info-strip"><ShieldCheck size={15}/><span>QQ、网盘文件下载后可批量拖入；旧版 .doc / .ppt 请另存为 DOCX / PPTX 或 PDF。待确认文件保存在你的学习空间，确认课程后才加入资料库并提取文字。</span></div><div className="modal-footer"><Button onClick={()=>{setJobs([]);setUploadOpen(false);navigate('home');}} disabled={!!busy}>稍后处理</Button><Button variant="primary" disabled={!!busy || !inbox.length || inbox.some(item=>!item.courseId)} onClick={()=>void uploadFiles()}>{busy==='导入资料'?<LoaderCircle size={16} className="spin"/>:<Upload size={16}/>}确认归属并导入</Button></div></> : <>
        <div className="sample-intro"><span className="sample-icon"><BookOpen size={23}/></span><div><h3>{mathDemo?'概率论 · 期末复习体验包':'高中语文 · 高考真题资料'}</h3><p>{mathDemo?'4 份简短中文 PDF，用于体验演示流程。':'2023、2024 年全国新课标卷。打开整卷后可按阅读、语言运用、写作等部分选择。'}</p></div></div>
        <div className="sample-list">{mathDemo ? mathSampleKeys.map(key=><div key={key}><FileText size={18}/><div><b>{sampleInfo[key].name}</b><small>{key==='note'?'故意包含错误，用于演示冲突处理':key==='exercises'?'后续补充，用于演示增量更新':'自编演示资料'}</small></div><a href={`/api/samples/${key}`} aria-label={`下载${sampleInfo[key].name}`}><ArrowDownToLine size={17}/></a></div>) : Object.entries(chineseExamInfo).map(([key,info])=><div key={key}><FileText size={18}/><div><b>{info.name}</b><small>{info.chapter} · <a href={info.source} target="_blank" rel="noreferrer">查看原始来源</a></small></div></div>)}</div>
        <div className="info-strip"><CircleAlert size={15}/><span>{mathDemo?'先导入基础资料，再补充练习。':'同一套试卷只导入一份；2024 年Ⅰ卷附参考答案，2023 年Ⅰ卷和 2024 年Ⅱ卷只有试题。'}</span></div>
        <div className="modal-footer">{mathDemo&&<Button disabled={!!busy} onClick={()=>void importSamples('supplement')}>仅补充练习</Button>}<Button variant="primary" disabled={!!busy} onClick={()=>void importSamples('core')}>{busy?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>}导入{mathDemo?'基础演示资料':'整套试卷'}</Button></div>
      </>}
    </Modal>
    <Modal error={error} open={rangeOpen} onOpenChange={v=>{if(!busy)setRangeOpen(v);}} title="确定本次复习范围" description="选中的资料将成为提纲依据。这里使用明确标注的模拟 AI 生成。">
      <p className="field-label">复习章节</p><div className="topic-options">{(mathDemo?[['conditional','条件概率'],['independence','事件的独立性']]:[]).map(([key,label])=><label key={key}><input type="checkbox" checked={topics.includes(key)} onChange={e=>setTopics(v=>e.target.checked?[...v,key]:v.filter(k=>k!==key))}/>{label}</label>)}</div>
      <p className="field-label">纳入的参考资料</p><div className="range-materials">{materials.filter(m=>m.status==='ready'&&!m.excluded).map(m=><label key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,m.id]:v.filter(id=>id!==m.id))}/><FileText size={17}/><span>{m.name}</span></label>)}</div>
      {issues.length>0 && <div className="range-warning"><CircleAlert size={18}/><div><b>还有 {issues.length} 份冲突笔记未处理</b><p>请先采纳参考结论，或提交暂不采纳的原因。这些笔记不会自动用于生成，原文件也不会被修改。</p><Button size="sm" disabled={!!busy} onClick={()=>{setRangeOpen(false);setView('library');setPanel({material:issues[0]});}}>处理内容冲突</Button></div></div>}
      {pausedConflicts.length>0 && <div className="range-warning conflict-paused-summary"><CircleAlert size={18}/><div><b>{pausedConflicts.length} 份资料因内容冲突已暂停</b><p>本次不会使用这些资料，其他无冲突资料仍可继续生成。</p></div></div>}
      <div className="range-summary"><span>已选 {selected.length} 份资料</span><span>{excluded.length} 份已排除</span><span>{materials.filter(m=>m.status==='stored').length} 份待提取文字</span></div><div className="modal-footer"><span className="muted small">结果附出处，缺失内容会提示。</span><Button variant="primary" disabled={!!busy || !selected.length || !topics.length || issues.length>0} onClick={()=>void generate()}>{busy?<LoaderCircle className="spin" size={16}/>:<FileText size={16}/>}生成演示提纲</Button></div>
    </Modal>
    <Modal open={historyOpen} onOpenChange={setHistoryOpen} title="对话历史" description={course?.name ? '继续' + course.name + '的学习对话。' : '选择一段对话继续学习。'}>
      <label className="conversation-history-search"><Search size={16}/><input autoFocus type="search" aria-label="搜索对话历史" placeholder="搜索对话" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)}/></label>
      <ul className="conversation-history-list">{historyConversations.map(conversation => <li key={conversation.id} className="conversation-history-row"><button type="button" className="conversation-history-entry" aria-current={activeConversationId === conversation.id ? 'true' : undefined} onClick={() => { void navigate('home').then(changed=>{if(changed)setActiveConversationId(conversation.id);}); }}><MessageSquare size={16}/><span><strong>{conversation.title}</strong><small>{conversation.messageCount} 条消息 · {dateLabel(conversation.updatedAt)}</small></span></button><span className="conversation-history-actions"><button type="button" aria-label={'重命名' + conversation.title} title="重命名" onClick={() => openRenameConversation(conversation)}><PencilLine size={15}/></button><button type="button" aria-label={'删除' + conversation.title} title="删除" onClick={() => openDeleteConversation(conversation)}><Trash2 size={15}/></button></span></li>)}{!historyConversations.length && <li className="conversation-history-empty"><MessageSquare size={24}/><p>{historyQuery ? '没有找到匹配的对话' : '还没有对话'}</p><small>{historyQuery ? '试试其他关键词。' : '开始一次学习，对话会保存在这里。'}</small></li>}</ul>
    </Modal>
    <Modal open={courseShelfOpen} onOpenChange={value=>{if(!value)setCourseShelfOpen(false);}} title="我的课程书架" description="像打开一本书一样进入课程；封面书名默认使用你输入的课程名。">
      <div className="course-shelf-grid">{workspace.courses.map(item => { const itemMaterials = workspace.materials.filter(material => material.courseId === item.id).length; const itemVersions = workspace.versions.filter(version => version.courseId === item.id).length; return <button type="button" key={item.id} className={`course-book ${item.id===courseId?'selected':''}`} onClick={()=>{navigate('home',item.id);setCourseShelfOpen(false);}}><CourseCover title={item.name} seed={item.id}/><span className="course-book-title">{item.name}</span><small>{itemMaterials} 份资料 · {itemVersions} 个版本</small>{item.id===courseId&&<em>当前课程</em>}</button>; })}<button type="button" className="course-book course-book-add" onClick={()=>{setCourseShelfOpen(false);setCreateOpen(true);}}><span className="course-book-add-icon"><Plus size={24}/></span><b>添加新课程</b><small>输入课程名，生成新的学习空间</small></button></div>
      <div className="course-shelf-note"><BookOpen size={15}/><span>每门课程都有独立的资料、对话、复习材料和版本记录。</span></div>
    </Modal>
    <Modal open={profileOpen} onOpenChange={setProfileOpen} title="我的学习空间" description="当前课程的学习概况与私人空间说明。">
      <div className="profile-summary"><span className="profile-summary-avatar">我</span><div><b>私人学习者</b><span>{course?.name ?? '尚未选择课程'}</span></div></div><div className="profile-stats"><div><b>{materials.length}</b><span>份课程资料</span></div><div><b>{chatConversations.length}</b><span>段对话记录</span></div><div><b>{versions.length}</b><span>个复习版本</span></div></div><div className="profile-privacy"><ShieldCheck size={17}/><div><b>资料保存在你的学习空间</b><p>上传的文件、对话历史和复习版本不会自动公开。发送给 AI 前，系统会在操作处明确提示。</p></div></div><div className="modal-footer"><span className="muted small">当前课程：{course?.name ?? '未选择'}</span>{workspace.privateCloud && <Button onClick={async () => { await notebook.flush('退出前保存'); const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (response.ok) location.href = '/login'; else setError('退出暂未完成，请重试。'); }}>退出登录</Button>}<Button onClick={()=>setProfileOpen(false)}>完成</Button></div>
    </Modal>
    <Modal error={error} open={createOpen} onOpenChange={setCreateOpen} title="添加一本课程书" description="输入书名即可创建独立的资料、对话和复习空间。"><form onSubmit={e=>{e.preventDefault();void run('添加课程',async()=>{const c=await api<Course>('/api/workspace',{action:'create-course',name:courseName});await reload();setCreateOpen(false);setCourseName('');navigate('home',c.id);});}}><label className="form-field">书名 / 课程名称<input autoFocus value={courseName} onChange={e=>setCourseName(e.target.value)} placeholder="例如：高等数学 · 期末复习" maxLength={60} required/></label><p className="form-helper">这个名称会显示在书架封面上；以后可以再接入 AI 根据资料自动建议书名。</p><div className="modal-footer"><Button onClick={()=>setCreateOpen(false)}>取消</Button><Button variant="primary" type="submit" disabled={!!busy || !courseName.trim()}>创建学习空间</Button></div></form></Modal>
    <Modal open={!!historical} onOpenChange={v=>{if(!v)setHistorical(null);}} title={`复习提纲 · 版本 ${historical?.number??''}`} description="历史快照只读，查看不会修改当前版本。" wide>{historical && <><div className="history-meta">{dateLabel(historical.createdAt)} · {aiAssistantText(historical.summary)}</div><div className="history-content">{historical.sections.map(s=><section key={s.id}><h3>{s.title}</h3>{s.generation&&<p className="citation-notice">{contentOriginLabel(s.generation)}{s.edited&&' · 个人修订'}</p>}<Markdown text={s.body}/>{s.needsReview&&<p className="citation-notice">本版本中，该段引用尚待用户重新核对。</p>}{s.generation?.contentOrigin==='ai-supplement'&&<p className="citation-notice">{referenceOriginLabel(s.generation)}</p>}<div className="citations">{s.refs.map(r=><button key={r.materialId} onClick={()=>openReference(r)}><FileText size={13}/>{r.name} · {sourceLocation(r.name,r.page)}</button>)}</div></section>)}</div><div className="modal-footer"><span className="muted small">原有版本始终保留。</span><Button onClick={()=>exportOutline(historical)}><ArrowDownToLine size={16}/>导出此版本</Button></div></>}</Modal>
    <Modal error={error} open={!!materialToDelete} onOpenChange={value=>{if(!value&&!busy)setMaterialToDelete(null);}} title="删除资料" description="请确认要删除的资料。">
      {materialToDelete && <><p className="muted">确定删除“{materialToDelete.name}”吗？该资料会从当前课程移除；若原文件没有被其他课程使用，也会从学习空间删除。已保存的复习版本与作答仍保留，但其中指向这份原文件的链接将无法打开。此操作无法撤销。</p><div className="modal-footer"><Button onClick={()=>setMaterialToDelete(null)} disabled={!!busy}>取消</Button><Button variant="danger" onClick={()=>void deleteMaterial()} disabled={!!busy}>{busy==='删除资料'?'正在删除':'确认删除'}</Button></div></>}
    </Modal>
    <Modal error={error} open={!!conversationDialog} onOpenChange={value=>{if(!value&&!busy){setConversationDialog(null);setConversationTitle('');}}} title={conversationDialog?.kind==='rename'?'重命名对话':'删除对话'} description={conversationDialog?.kind==='rename'?'给这段学习对话一个容易找到的名称。':'只删除对话记录，不会删除资料、复习材料或练习。'}>
      {conversationDialog?.kind==='rename' ? <form onSubmit={e=>{e.preventDefault();void submitConversationDialog();}}><label className="form-field">对话名称<input autoFocus value={conversationTitle} onChange={e=>setConversationTitle(e.target.value)} maxLength={80} required/></label><div className="modal-footer"><Button onClick={()=>setConversationDialog(null)} disabled={!!busy}>取消</Button><Button variant="primary" type="submit" disabled={!!busy||!conversationTitle.trim()}>保存名称</Button></div></form> : conversationDialog?.kind==='delete' ? <div><p className="muted">确定删除“{conversationDialog.conversation.title}”吗？这只会删除对话记录。</p><div className="modal-footer"><Button onClick={()=>setConversationDialog(null)} disabled={!!busy}>取消</Button><Button variant="danger" onClick={()=>void submitConversationDialog()} disabled={!!busy}>删除对话</Button></div></div> : null}
    </Modal>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button aria-label="关闭操作提示" onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div></NotebookProvider></PracticeHubProvider>;
}
