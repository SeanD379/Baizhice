'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, LoaderCircle, RotateCw, FileWarning, Maximize, Minimize, MousePointer2, Pencil, Highlighter, Eraser, Undo2, Palette } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './ui/button';
import { CaptureButton } from './notebook-context';
import type { ReadingLandmark } from '@/lib/exam-reading';
import { eraseAnnotationRange, eraseAnnotationStroke, type AnnotationStroke } from '@/lib/exam-record';
import { PreviewAnnotations, type PreviewAnnotationProps } from './preview-annotations';

type AnnotationTool = 'browse' | 'pen' | 'highlighter' | 'eraser';
type EraseMode = 'stroke' | 'area';
type Props = { url: string; initialPage?: number; name?: string; pageUnit?: '页' | '张幻灯片'; landmarks?: ReadingLandmark[]; annotations?: Record<string, AnnotationStroke[]>; onAnnotationsChange?: (page: number, strokes: AnnotationStroke[]) => void; studyAnnotations?: PreviewAnnotationProps };
const penPresets = [{ color: '#c53b32', label: '红色' }, { color: '#2864b4', label: '蓝色' }, { color: '#202124', label: '黑色' }];
const highlighterPresets = [{ color: '#e8c53b', label: '黄色' }, { color: '#7eac5c', label: '绿色' }, { color: '#ec75ab', label: '粉色' }];

export default function PdfPreview({ url, initialPage = 1, name = '原始文件', pageUnit = '页', landmarks, annotations, onAnnotationsChange, studyAnnotations }: Props) {
  const [annotationRoot, setAnnotationRoot] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), inkCanvas = useRef<HTMLCanvasElement>(null), holder = useRef<HTMLDivElement>(null);
  const textLayer = useRef<HTMLDivElement>(null), [pageText, setPageText] = useState(''), [selectedText, setSelectedText] = useState('');
  const drawing = useRef<AnnotationStroke | null>(null), erasing = useRef<{ strokes: AnnotationStroke[]; changed: boolean; last: [number, number] } | null>(null), undoHistory = useRef<Record<number, AnnotationStroke[][]>>({});
  const expandButton = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false), [availableWidth, setAvailableWidth] = useState(0);
  const [page, setPage] = useState(initialPage), [pages, setPages] = useState(1), [zoom, setZoom] = useState(1), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [zoomDraft, setZoomDraft] = useState('100');
  const [pageSize, setPageSize] = useState({ width: 0, height: 0, density: 1 });
  const [tool, setTool] = useState<AnnotationTool>('browse');
  const [penColor, setPenColor] = useState('#2864b4');
  const [highlightColor, setHighlightColor] = useState('#e8c53b');
  const [penWidth, setPenWidth] = useState(2.5);
  const [highlightWidth, setHighlightWidth] = useState(18);
  const [eraseMode, setEraseMode] = useState<EraseMode>('stroke');
  const [eraseSize, setEraseSize] = useState(32);
  const [eraseCursor, setEraseCursor] = useState<{ x: number; y: number; scale: number } | null>(null);
  const pageStrokes = annotations?.[String(page)] ?? [];
  useEffect(() => { setPage(initialPage); setZoom(1); }, [url, initialPage]);
  useEffect(() => { if (studyAnnotations?.focusAnchor?.page) setPage(studyAnnotations.focusAnchor.page); }, [studyAnnotations?.focusAnchor]);
  useEffect(() => { setZoomDraft(String(Math.round(zoom * 100))); }, [zoom]);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fullscreen]);
  useEffect(() => {
    let disposed = false;
    let task: { destroy: () => Promise<void> } | undefined;
    setLoading(true); setError(''); setPageText(''); setSelectedText('');
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const loadingTask = pdfjs.getDocument({ url }); task = loadingTask;
        const doc = await loadingTask.promise;
        if (disposed) return;
        setPages(doc.numPages);
        const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
        const element = canvas.current;
        if (!element || disposed) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = Math.max(240, (holder.current?.clientWidth ?? 380) - 28);
        const viewport = pdfPage.getViewport({ scale: width / base.width * zoom });
        const density = Math.min(window.devicePixelRatio || 1, 2);
        element.width = Math.floor(viewport.width * density); element.height = Math.floor(viewport.height * density);
        element.style.width = `${viewport.width}px`; element.style.height = `${viewport.height}px`;
        setPageSize(previous => previous.width === viewport.width && previous.height === viewport.height && previous.density === density ? previous : { width: viewport.width, height: viewport.height, density });
        const context = element.getContext('2d'); if (!context) throw new Error('无法显示文件');
        await pdfPage.render({ canvas: element, canvasContext: context, viewport, transform: [density, 0, 0, density, 0, 0] }).promise;
        if (!disposed && textLayer.current && typeof pdfPage.getTextContent === 'function' && pdfjs.TextLayer) {
          const text = await pdfPage.getTextContent(); if (disposed) return;
          setPageText(text.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
          textLayer.current.replaceChildren(); textLayer.current.style.setProperty('--scale-factor', String(viewport.scale));
          await new pdfjs.TextLayer({ textContentSource: text, container: textLayer.current, viewport }).render();
        }
        if (!disposed) setLoading(false);
      } catch (error) {
        if (!disposed) { console.warn('PDF preview:', error); setError('文件未能显示。请重试，或下载原文件查看。'); setLoading(false); }
      }
    })();
    return () => { disposed = true; void task?.destroy(); };
  }, [url, page, zoom, retry, fullscreen, availableWidth]);
  function paintInk(active: AnnotationStroke | null = drawing.current, strokes = pageStrokes) {
    const element = inkCanvas.current;
    if (!element || !pageSize.width || !pageSize.height) return;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(pageSize.density, 0, 0, pageSize.density, 0, 0);
    context.clearRect(0, 0, pageSize.width, pageSize.height);
    for (const stroke of [...strokes, ...(active ? [active] : [])]) {
      const points = stroke.points;
      context.beginPath();
      context.lineCap = 'round'; context.lineJoin = 'round';
      context.strokeStyle = stroke.color; context.fillStyle = stroke.color;
      context.globalAlpha = stroke.tool === 'highlighter' ? .34 : 1;
      context.lineWidth = (stroke.width ?? (stroke.tool === 'highlighter' ? 18 : 2.5)) * pageSize.width / 600;
      if (points.length === 1) {
        context.arc(points[0][0] * pageSize.width, points[0][1] * pageSize.height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        points.forEach(([x, y], index) => index ? context.lineTo(x * pageSize.width, y * pageSize.height) : context.moveTo(x * pageSize.width, y * pageSize.height));
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }
  useEffect(() => {
    const element = inkCanvas.current;
    if (!element || !pageSize.width) return;
    element.width = Math.floor(pageSize.width * pageSize.density);
    element.height = Math.floor(pageSize.height * pageSize.density);
    paintInk();
    // Redraw after a page, zoom, or saved annotation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, page, pageSize, fullscreen]);
  function pointAt(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 10000) / 10000, Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 10000) / 10000];
  }
  function rememberChange(next: AnnotationStroke[]) {
    undoHistory.current[page] ??= [];
    undoHistory.current[page].push(pageStrokes);
    onAnnotationsChange?.(page, next);
  }
  function eraseAt(strokes: AnnotationStroke[], x: number, y: number) {
    return eraseMode === 'stroke'
      ? eraseAnnotationStroke(strokes, x, y, pageSize.width, pageSize.height, 16)
      : eraseAnnotationRange(strokes, x, y, pageSize.width, pageSize.height, eraseSize / 2);
  }
  function moveEraseCursor(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool !== 'eraser' || eraseMode !== 'area') return;
    const rect = event.currentTarget.getBoundingClientRect();
    setEraseCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top, scale: rect.width / pageSize.width });
  }
  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === 'browse' || loading) return;
    event.preventDefault();
    moveEraseCursor(event);
    const [x, y] = pointAt(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'eraser') {
      const next = eraseAt(pageStrokes, x, y);
      erasing.current = { strokes: next, changed: next !== pageStrokes, last: [x, y] };
      paintInk(null, next);
      return;
    }
    drawing.current = { tool, color: tool === 'pen' ? penColor : highlightColor, width: tool === 'pen' ? penWidth : highlightWidth, points: [[x, y]] };
    paintInk();
  }
  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    moveEraseCursor(event);
    if (erasing.current) {
      event.preventDefault();
      const point = pointAt(event), erased = erasing.current;
      const distance = Math.hypot((point[0] - erased.last[0]) * pageSize.width, (point[1] - erased.last[1]) * pageSize.height);
      const steps = Math.max(1, Math.ceil(distance / Math.max(4, (eraseMode === 'area' ? eraseSize : 32) / 4)));
      let next = erased.strokes;
      for (let step = 1; step <= steps; step++) {
        const fraction = step / steps;
        next = eraseAt(next, erased.last[0] + (point[0] - erased.last[0]) * fraction, erased.last[1] + (point[1] - erased.last[1]) * fraction);
      }
      erasing.current = { strokes: next, changed: erased.changed || next !== erased.strokes, last: point };
      if (next !== erased.strokes) paintInk(null, next);
      return;
    }
    if (!drawing.current) return;
    event.preventDefault();
    const point = pointAt(event), previous = drawing.current.points.at(-1)!;
    if (Math.hypot((point[0] - previous[0]) * pageSize.width, (point[1] - previous[1]) * pageSize.height) < 2) return;
    if (drawing.current.points.length < 1500) drawing.current.points.push(point);
    paintInk();
  }
  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const erased = erasing.current;
    if (erased) {
      event.preventDefault();
      erasing.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (erased.changed) rememberChange(erased.strokes);
      return;
    }
    const stroke = drawing.current;
    if (!stroke) return;
    event.preventDefault();
    drawing.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    rememberChange([...pageStrokes, stroke]);
  }
  function undoAnnotation() {
    const previous = undoHistory.current[page]?.pop();
    if (previous) onAnnotationsChange?.(page, previous);
  }
  function commitZoom() {
    const percent = Number(zoomDraft);
    const next = Number.isFinite(percent) && percent > 0 ? Math.min(3, Math.max(.5, Math.round(percent) / 100)) : zoom;
    setZoom(next);
    setZoomDraft(String(Math.round(next * 100)));
  }
  const zoomControls = <div className="pdf-zoom-controls"><Button size="icon" variant="ghost" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, Math.round((value - .1) * 100) / 100))} aria-label="缩小原文"><Minus size={15}/></Button><label><span className="sr-only">缩放比例</span><input type="number" min="50" max="300" step="10" value={zoomDraft} aria-label="缩放比例（百分比）" onFocus={event => event.currentTarget.select()} onChange={event => setZoomDraft(event.target.value)} onBlur={commitZoom} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/><span>%</span></label><Button size="icon" variant="ghost" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, Math.round((value + .1) * 100) / 100))} aria-label="放大原文"><Plus size={15}/></Button></div>;
  const colorPresets = tool === 'pen' ? penPresets : highlighterPresets;
  const activeColor = tool === 'pen' ? penColor : highlightColor;
  const setActiveColor = tool === 'pen' ? setPenColor : setHighlightColor;
  const activeWidth = tool === 'pen' ? penWidth : highlightWidth;
  const setActiveWidth = tool === 'pen' ? setPenWidth : setHighlightWidth;
  const viewer = <div className="pdf-viewer"><div className="pdf-tools">
    <div><Button size="icon" variant="ghost" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)} aria-label={pageUnit === '页' ? '上一页' : '上一张幻灯片'}><ChevronLeft size={16} /></Button><span>第 {Math.min(page, pages)} / {pages} {pageUnit}</span><Button size="icon" variant="ghost" disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)} aria-label={pageUnit === '页' ? '下一页' : '下一张幻灯片'}><ChevronRight size={16} /></Button></div>
    {!onAnnotationsChange && zoomControls}
    <Button ref={expandButton} className="pdf-expand" size="sm" variant="ghost" onClick={() => setFullscreen(v => !v)} aria-label={fullscreen ? '退出全屏阅读' : '全屏阅读'}>{fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}<span>{fullscreen ? '退出全屏' : '全屏阅读'}</span></Button>
  </div>{onAnnotationsChange && <div className="pdf-annotation-tools" role="toolbar" aria-label="试卷批注工具">
    <div className="pdf-annotation-primary"><div className="pdf-annotation-main">
      <Button size="sm" variant={tool === 'browse' ? 'primary' : 'secondary'} aria-pressed={tool === 'browse'} onClick={() => setTool('browse')}><MousePointer2 size={14}/>浏览</Button>
      <Button size="sm" variant={tool === 'pen' ? 'primary' : 'secondary'} aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}><Pencil size={14}/>画笔</Button>
      <Button size="sm" variant={tool === 'highlighter' ? 'primary' : 'secondary'} aria-pressed={tool === 'highlighter'} onClick={() => setTool('highlighter')}><Highlighter size={14}/>荧光笔</Button>
      <Button size="sm" variant={tool === 'eraser' ? 'primary' : 'secondary'} aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}><Eraser size={14}/>橡皮擦</Button>
      <Button size="sm" variant="ghost" disabled={!undoHistory.current[page]?.length} onClick={undoAnnotation}><Undo2 size={14}/>撤销</Button>
    </div><div className="pdf-annotation-zoom">{zoomControls}</div></div>
    {(tool === 'pen' || tool === 'highlighter') && <div className="pdf-annotation-settings">
      <span>颜色</span><div className="pdf-ink-colors">{colorPresets.map(preset => <button key={preset.color} type="button" aria-label={`${preset.label}${tool === 'pen' ? '画笔' : '荧光笔'}`} aria-pressed={activeColor.toLowerCase() === preset.color} style={{ backgroundColor: preset.color }} onClick={() => setActiveColor(preset.color)}/>) }<label className="pdf-custom-color" title="选择更多颜色"><Palette size={15}/><span>更多颜色</span><input type="color" aria-label={`更多${tool === 'pen' ? '画笔' : '荧光笔'}颜色`} value={activeColor} onChange={event => setActiveColor(event.target.value)}/></label></div>
      <label className="pdf-ink-width"><span>粗细</span><input type="range" min={tool === 'pen' ? 1 : 8} max={tool === 'pen' ? 12 : 40} step={tool === 'pen' ? .5 : 2} value={activeWidth} aria-label={`${tool === 'pen' ? '画笔' : '荧光笔'}粗细`} onChange={event => setActiveWidth(Number(event.target.value))}/><output>{activeWidth}</output></label>
    </div>}
    {tool === 'eraser' && <div className="pdf-annotation-settings">
      <span>类型</span><div className="pdf-eraser-modes"><Button size="sm" variant={eraseMode === 'stroke' ? 'primary' : 'secondary'} aria-pressed={eraseMode === 'stroke'} onClick={() => setEraseMode('stroke')}>整笔擦</Button><Button size="sm" variant={eraseMode === 'area' ? 'primary' : 'secondary'} aria-pressed={eraseMode === 'area'} onClick={() => setEraseMode('area')}>范围擦</Button></div>
      {eraseMode === 'area' && <label className="pdf-ink-width"><span>擦拭范围</span><input type="range" min="8" max="80" step="4" value={eraseSize} aria-label="擦拭范围" onChange={event => setEraseSize(Number(event.target.value))}/><output>{eraseSize}</output></label>}
    </div>}
  </div>}{landmarks&&<nav className="pdf-landmarks" aria-label="跳转到题目和答案">{landmarks.map(item=><button key={item.label} type="button" aria-current={page===item.page?'page':undefined} onClick={()=>setPage(item.page)}>{item.label}<small>第 {item.page} 页</small></button>)}</nav>}<div className="pdf-canvas" ref={holder} onDoubleClick={() => { if (tool === 'browse') setFullscreen(value => !value); }} title={tool === 'browse' ? fullscreen ? '双击退出全屏' : '双击进入全屏' : '使用批注工具在原卷上标记'}>
    {loading && <div className="preview-loading" role="status"><LoaderCircle className="spin" size={20} /> 正在打开原文件</div>}
    {studyAnnotations && !loading && !error && <PreviewAnnotations {...studyAnnotations} root={annotationRoot} page={page}/>}
    {error ? <div className="preview-error"><FileWarning size={28} /><p>{error}</p><Button onClick={() => setRetry(r => r + 1)}><RotateCw size={15} />重试</Button></div> : <div className="pdf-page-surface" ref={setAnnotationRoot} style={{ width: pageSize.width || undefined, height: pageSize.height || undefined, visibility: loading ? 'hidden' : 'visible' }}><canvas ref={canvas} aria-label={`原文件第 ${page} ${pageUnit}`}/><div ref={textLayer} className="pdf-text-layer" style={{ pointerEvents: tool === 'browse' ? 'auto' : 'none' }} onMouseUp={() => { const selected = window.getSelection(); setSelectedText(selected?.anchorNode && selected.focusNode && textLayer.current?.contains(selected.anchorNode) && textLayer.current.contains(selected.focusNode) ? selected.toString().trim() : ''); }}/>{onAnnotationsChange && <canvas ref={inkCanvas} className={`pdf-ink-layer ${tool === 'browse' ? 'is-browsing' : ''} ${tool === 'eraser' && eraseMode === 'area' ? 'is-area-eraser' : ''}`} aria-label={`原文件第 ${page} 页批注层`} style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }} onPointerDown={beginStroke} onPointerMove={continueStroke} onPointerLeave={() => setEraseCursor(null)} onPointerUp={finishStroke} onPointerCancel={finishStroke}/>}{tool === 'eraser' && eraseMode === 'area' && eraseCursor && <span className="pdf-erase-cursor" aria-hidden="true" style={{ left: eraseCursor.x, top: eraseCursor.y, width: eraseSize * eraseCursor.scale, height: eraseSize * eraseCursor.scale }}/>}</div>}
  </div></div>;
  const materialId = url.match(/^\/api\/files\/([^/?#]+)/)?.[1];
  const capture = materialId && pageText && <CaptureButton title={`${name} · 第 ${page} 页`} body={selectedText || pageText} origin={{ kind: 'material', label: selectedText ? '原文摘录' : '原文整页', refs: [{ materialId, name, page, snippet: (selectedText || pageText).slice(0, 1000) }], needsReview: true }}/>;
  return <Dialog.Root open={fullscreen} onOpenChange={setFullscreen}>
    {!fullscreen && <>{viewer}{capture}</>}
    <Dialog.Portal><Dialog.Overlay className="pdf-fullscreen-backdrop"/><Dialog.Content className="pdf-fullscreen" onEscapeKeyDown={e => e.stopPropagation()} onCloseAutoFocus={e => { e.preventDefault(); expandButton.current?.focus(); }}>
      <header className="pdf-fullscreen-heading"><Dialog.Title>{name}</Dialog.Title><Dialog.Description>全屏阅读 · 按 Esc 返回资料面板</Dialog.Description></header>
      {fullscreen && <>{viewer}{capture}</>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
