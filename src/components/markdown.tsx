'use client';
import { withBasePath } from '@/lib/base-path';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml components={{ img: () => null, a: ({ children, href }) => <a href={href ? withBasePath(href) : href} target="_blank" rel="noreferrer">{children}</a> }}>{text}</ReactMarkdown></div>;
}
