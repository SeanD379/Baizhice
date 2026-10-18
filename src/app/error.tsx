'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="fatal"><h1>页面暂时无法显示</h1><p>已保存的资料仍保留在本机。请重试。</p><button className="btn btn-primary" onClick={reset}>重新打开</button></main>;
}
