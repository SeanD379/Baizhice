'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize, Minimize, Minus, Plus, RotateCw } from 'lucide-react';
import { Button } from './ui/button';
import { PreviewAnnotations, previewQuoteRange, type PreviewAnnotationProps } from './preview-annotations';

const frameDocument = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f1f2f4}body{overflow:hidden}.docx-wrapper{padding:14px!important;background:#f1f2f4!important}.docx-wrapper>section{margin-bottom:0!important}a{pointer-events:none}</style></head><body></body></html>';

export default function WordPreview({ url, name, studyAnnotations }: { url: string; name: string; studyAnnotations?: PreviewAnnotationProps }) {
  const [annotationRoot, setAnnotationRoot] = useState<HTMLElement | null>(null);
  const frame = useRef<HTMLIFrameElement>(null), scope = useRef<HTMLDivElement>(null), documentPages = useRef<HTMLElement[]>([]);
  const [frameReady, setFrameReady] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [zoom, setZoom] = useState(1), [width, setWidth] = useState(0), [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const element = scope.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    const fullscreenChanged = () => setFullscreen(document.fullscreenElement === element);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    return () => {observer.disconnect();document.removeEventListener('fullscreenchange', fullscreenChanged);};
  }, []);
  useEffect(() => {
    if (!frameReady) return;
    const controller = new AbortController();
    let disposed = false;
    setLoaded(false); setError(''); setPage(1); setZoom(1);
    void (async () => {
      try {
        const response = await fetch(url, {signal:controller.signal});
        if (!response.ok) throw new Error('原文件暂时无法读取。');
        const bytes = await response.arrayBuffer();
        const { renderAsync } = await import('docx-preview');
        const doc = frame.current?.contentDocument;
        if (disposed || !doc) return;
        doc.body.replaceChildren();
        await renderAsync(bytes, doc.body, doc.head, {ignoreLastRenderedPageBreak:false,renderAltChunks:false,useBase64URL:true});
        if (disposed) return;
        documentPages.current = [...doc.querySelectorAll<HTMLElement>('.docx-wrapper>section.docx')];
        if (!documentPages.current.length) throw new Error('文档中没有可预览的页面。');
        setPages(documentPages.current.length); setLoaded(true);
      } catch {
        if (!disposed) setError('Word 预览暂时无法显示，请重试或下载原文件查看。');
      }
    })();
    return () => {disposed = true;controller.abort();};
  }, [url, frameReady, retry]);
  useEffect(() => {
    if (!loaded || !studyAnnotations?.focusAnchor) return;
    const anchor = studyAnnotations.focusAnchor;
    const match = documentPages.current.findIndex(element => !!previewQuoteRange(element,anchor));
    if (anchor.quote && match >= 0) setPage(match + 1);
    else if (anchor.displayPage) setPage(Math.min(pages, anchor.displayPage));
  }, [loaded, pages, studyAnnotations?.focusAnchor]);
  useEffect(() => {
    const doc = frame.current?.contentDocument, element = documentPages.current[page-1];
    if (!loaded || !doc || !element) return;
    setAnnotationRoot(element);
    doc.documentElement.style.zoom = '1';
    documentPages.current.forEach((item,index) => {item.style.display = index===page-1 ? '' : 'none';});
    const scale = Math.max(0.1, ((width || scope.current?.clientWidth || 800)-28)/element.offsetWidth)*zoom;
    const height = (element.offsetHeight+28)*scale;
    doc.documentElement.style.zoom = String(scale);
    frame.current!.style.height = `${Math.ceil(height)}px`;
  }, [loaded, page, width, zoom]);
  return <div className="word-preview" ref={scope}>
    <div className="pdf-tools word-preview-tools">
      <div><Button size="icon" variant="ghost" disabled={!loaded || page<=1} aria-label="上一页" onClick={() => setPage(value => value-1)}><ChevronLeft size={16}/></Button><span title="此处为文档预览分页，批注出处按原文段落定位。">预览 {page} / {pages}</span><Button size="icon" variant="ghost" disabled={!loaded || page>=pages} aria-label="下一页" onClick={() => setPage(value => value+1)}><ChevronRight size={16}/></Button></div>
      <div className="pdf-zoom"><Button size="icon" variant="ghost" disabled={!loaded || zoom<=0.5} aria-label="缩小原文" onClick={() => setZoom(value => Math.max(0.5,value-0.1))}><Minus size={15}/></Button><span>{Math.round(zoom*100)}%</span><Button size="icon" variant="ghost" disabled={!loaded || zoom>=3} aria-label="放大原文" onClick={() => setZoom(value => Math.min(3,value+0.1))}><Plus size={15}/></Button></div>
      <Button className="pdf-expand" size="sm" variant="ghost" aria-label={fullscreen ? '退出全屏阅读' : '全屏阅读'} onClick={() => {if (fullscreen) void document.exitFullscreen(); else void scope.current?.requestFullscreen();}}>{fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}<span>{fullscreen ? '退出全屏' : '全屏阅读'}</span></Button>
    </div>
    {error ? <div className="preview-error"><p>{error}</p><Button onClick={() => setRetry(value => value+1)}><RotateCw size={15}/>重试</Button></div> : !loaded && <div className="preview-loading" role="status"><LoaderCircle className="spin" size={20}/>正在打开 Word 文档</div>}
    <iframe ref={frame} title={`${name} · Word 原文件预览`} sandbox="allow-same-origin" srcDoc={frameDocument} onLoad={() => setFrameReady(true)} hidden={!loaded || !!error}/>
    {studyAnnotations && loaded && !error && <PreviewAnnotations {...studyAnnotations} root={annotationRoot} page={page} paragraph/>}
  </div>;
}
