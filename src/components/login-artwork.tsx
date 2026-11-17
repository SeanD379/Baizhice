'use client';
import { withBasePath } from '@/lib/base-path';

import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useAppReducedMotion } from './user-preferences';

const ModelViewer = lazy(() => import('./react-bits/ModelViewer'));

class ArtworkBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function LoginArtwork() {
  const reducedMotion = useAppReducedMotion();
  const [desktop, setDesktop] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => { setFailed(true); setReady(false); }, []);
  useLayoutEffect(() => setReady(false), [reducedMotion]);
  useEffect(() => {
    const query = window.matchMedia?.('(min-width: 960px)');
    if (!query) return;
    const update = () => { setDesktop(query.matches); setReady(false); };
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const animate = desktop && !reducedMotion && !failed;
  return <div className="login-artwork" data-login-artwork data-state={animate && ready ? 'animated' : 'static'} aria-hidden="true">
    <img className="login-artwork-poster" src={withBasePath("/brand/login-book-poster.png")} alt="" width={1200} height={1000} fetchPriority="high"/>
    {animate && <ArtworkBoundary onError={onError}><Suspense fallback={null}>
      <ModelViewer url={withBasePath("/brand/login-book.glb")} width="100%" height="100%" className="login-artwork-canvas" environment="none" exposure={1.15} autoRotate={false} dragRotate={false} zoom={false} resetOnDoubleClick={false} hoverTilt={0.10} float={0.55} shadowOpacity={0.18} intro="none" startAngle={0} tilt={0} fit={1.25} onModelLoaded={onReady} onError={onError}/>
    </Suspense></ArtworkBoundary>}
  </div>;
}
