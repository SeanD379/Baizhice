'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { documentLabel } from '@/lib/document-labels';
import type { Material } from '@/lib/types';
import type { ReadingLandmark } from '@/lib/exam-reading';
import { PreviewAnnotations, type PreviewAnnotationProps } from './preview-annotations';

const PdfPreview = dynamic(() => import('./pdf-preview'), { ssr: false, loading: () => <div className="preview-loading" role="status"><LoaderCircle className="spin" size={20}/>正在载入原文件预览</div> });
const WordPreview = dynamic(() => import('./word-preview'), { ssr: false, loading: () => <div className="preview-loading" role="status"><LoaderCircle className="spin" size={20}/>正在载入 Word 预览</div> });

function TextPreview({ url, studyAnnotations }: { url: string; studyAnnotations?: PreviewAnnotationProps }) {
  const [annotationRoot, setAnnotationRoot] = useState<HTMLPreElement | null>(null);
  const [text, setText] = useState<string | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setText(null); setError('');
    void fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('原文件暂时无法读取，请重试或下载查看。');
      const value = await response.text();
      if (!controller.signal.aborted) setText(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '原文件暂时无法读取。'); });
    return () => controller.abort();
  }, [url, retry]);
  return error ? <div className="preview-error"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>重试</Button></div> : text === null ? <div className="preview-loading" role="status"><LoaderCircle className="spin" size={20}/>正在打开原文件</div> : <><pre ref={setAnnotationRoot} className="original-text-preview">{text}</pre>{studyAnnotations && <PreviewAnnotations {...studyAnnotations} root={annotationRoot} page={1} paragraph/>}</>;
}

export function OriginalFilePreview({ material, initialPage = 1, landmarks, studyAnnotations }: { material: Material; initialPage?: number; landmarks?: ReadingLandmark[]; studyAnnotations?: PreviewAnnotationProps }) {
  const [annotationRoot, setAnnotationRoot] = useState<HTMLDivElement | null>(null);
  const originalUrl = `/api/files/${material.id}`;
  const word = /\.docx$/i.test(material.name);
  const slides = /\.pptx$/i.test(material.name);
  const label = documentLabel(material.mime);
  return <section className={`original-file-preview${slides ? ' original-slide-preview' : ''}`} aria-label={`${label} 原文件预览`} data-format={label}>
    {word ? <WordPreview key={material.id} name={material.name} url={originalUrl} studyAnnotations={studyAnnotations}/> : slides || material.mime === 'application/pdf' ? <PdfPreview key={material.id} name={material.name} url={slides ? `/api/materials/${material.id}/preview` : originalUrl} initialPage={initialPage} pageUnit={slides ? '张幻灯片' : '页'} landmarks={slides ? undefined : landmarks} studyAnnotations={studyAnnotations}/> : material.mime.startsWith('image/') ? <div className="image-preview" ref={setAnnotationRoot}><img src={originalUrl} alt={material.name} onError={event => {event.currentTarget.alt = '图片无法显示，请打开原文件检查。';}}/>{studyAnnotations && <PreviewAnnotations {...studyAnnotations} root={annotationRoot} page={1}/>}</div> : <TextPreview url={originalUrl} studyAnnotations={studyAnnotations}/>}
  </section>;
}
