import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/ui-theme';
import { themeInitScript } from '@/lib/ui-theme';
import './globals.css';
import './learning.css';
import './analytics.css';
import './generation.css';
import './content-sections.css';
import './library-explorer.css';
import './exam.css';
import './original-practice.css';
import './notebook.css';
import './app-shell-5.css';
import './material-study.css';
import './practice-hub.css';
import './chat.css';
import 'katex/dist/katex.min.css';
import './theme.css';
import './brand.css';
export const metadata: Metadata = { title: '百知册', applicationName: '百知册', description: '把零散资料，学成完整知识。' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" data-theme="light" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeInitScript }}/></head><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
