'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FileText } from 'lucide-react';
import { gsap } from 'gsap';
import { Draggable } from 'gsap/Draggable';
import { useGSAP } from '@gsap/react';
import type { Material } from '@/lib/types';

gsap.registerPlugin(useGSAP);

type Props = {
  scope: RefObject<HTMLDivElement | null>; visible: Material[]; selectedIds: string[]; disabled: boolean;
  onStart: (ids: string[]) => void; onDrop: (materials: Material[], targetId: string) => void;
};

export function useLibraryDrag(props: Props) {
  const latest = useRef(props); latest.current = props;
  const ghost = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null), cover = useRef<SVGSVGElement>(null);
  const name = useRef<HTMLSpanElement>(null), count = useRef<HTMLElement>(null), hint = useRef<HTMLDivElement>(null);
  const instance = useRef<Draggable | null>(null);
  const session = useRef<{ materials: Material[]; target: HTMLElement | null; sourceX: number; sourceY: number; cancelled: boolean } | null>(null);
  const completing = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false), [draggingIds, setDraggingIds] = useState<string[]>([]);
  useEffect(() => { setReady(true); }, []);
  const { contextSafe } = useGSAP({ scope: props.scope });
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const clearTargets = () => latest.current.scope.current?.querySelectorAll('[data-drop-active]').forEach(element => element.removeAttribute('data-drop-active'));

  const cancel = contextSafe(() => {
    if (session.current) session.current.cancelled = true;
    if (instance.current) instance.current.endDrag(instance.current.pointerEvent);
    clearTargets(); setDraggingIds([]);
    if (ghost.current) gsap.set(ghost.current, { autoAlpha: 0 });
    if (cover.current) gsap.set(cover.current, { autoAlpha: 0 });
    session.current = null;
  });
  const returnCard = contextSafe(() => {
    clearTargets(); setDraggingIds([]);
    const source = session.current;
    if (!source || !ghost.current) return;
    gsap.to(ghost.current, { x: reduced() ? undefined : source.sourceX, y: reduced() ? undefined : source.sourceY, autoAlpha: 0, duration: reduced() ? 0.1 : 0.16, ease: 'power3.out', overwrite: true });
    session.current = null;
  });

  useGSAP((_context, safe) => {
    if (!ready || !ghost.current || !card.current) return;
    gsap.registerPlugin(Draggable);
    const triggers = props.scope.current?.querySelectorAll('[data-material-drag]');
    if (!triggers?.length) return;
    const moveTarget = safe!((drag: Draggable) => {
      const current = session.current;
      if (!current) return;
      const x = drag.pointerX - window.scrollX, y = drag.pointerY - window.scrollY;
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-folder]');
      const targets = [...latest.current.scope.current!.querySelectorAll<HTMLElement>('[data-drop-folder]')];
      const eligible = (element: HTMLElement) => current.materials.some(material => (material.folderId ?? '') !== element.dataset.dropFolder);
      const target = hit && targets.includes(hit) && eligible(hit) ? hit : null;
      const near = target ?? targets.find(element => {
        if (!eligible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight && Math.hypot(x - gsap.utils.clamp(rect.left, rect.right, x), y - gsap.utils.clamp(rect.top, rect.bottom, y)) <= 12;
      });
      clearTargets();
      if (target) target.dataset.dropActive = 'true';
      current.target = target;
      let offsetX = 0, offsetY = 0;
      if (near && !reduced()) {
        const rect = near.getBoundingClientRect();
        offsetX = gsap.utils.clamp(-6, 6, (rect.left + rect.width / 2 - x) * 0.08);
        offsetY = gsap.utils.clamp(-6, 6, (rect.top + rect.height / 2 - y) * 0.08);
      }
      gsap.to(card.current, { x: offsetX, y: offsetY, duration: 0.1, ease: 'power3.out', overwrite: true });
      if (hint.current) hint.current.textContent = target ? `松手移到「${target.dataset.dropName}」` : near ? `靠近「${near.dataset.dropName}」` : '拖到文件夹 · Esc 取消';
    });
    const [drag] = Draggable.create(ghost.current, {
      type: 'x,y', trigger: [...triggers], minimumMovement: 6, zIndexBoost: false, dragClickables: true,
      onPressInit: safe!((event: PointerEvent) => {
        if (latest.current.disabled) return;
        const id = (event.target as Element).closest<HTMLElement>('[data-material-drag]')?.dataset.materialDrag;
        const material = latest.current.visible.find(item => item.id === id);
        if (!material) return;
        const moving = latest.current.selectedIds.includes(material.id) ? latest.current.visible.filter(item => latest.current.selectedIds.includes(item.id)) : [material];
        const sourceX = instance.current!.pointerX - window.scrollX + 14, sourceY = instance.current!.pointerY - window.scrollY - 30;
        session.current = { materials: moving, target: null, sourceX, sourceY, cancelled: false };
        completing.current?.();
        gsap.killTweensOf([ghost.current, card.current]);
        gsap.set(ghost.current, { x: sourceX, y: sourceY, rotation: 0, autoAlpha: 0 });
        gsap.set(card.current, { x: 0, y: 0, scaleX: 1, scaleY: 1, autoAlpha: 1 });
        ghost.current!.dataset.count = String(Math.min(3, moving.length));
        ghost.current!.dataset.state = 'dragging';
        name.current!.textContent = moving[0].name;
        count.current!.textContent = `${moving.length} 份资料`;
      }),
      onPress: function(this: Draggable) { if (latest.current.disabled || !session.current) this.endDrag(this.pointerEvent); },
      onDragStart: safe!(() => {
        if (!session.current) return;
        const ids = session.current.materials.map(item => item.id);
        setDraggingIds(ids); latest.current.onStart(ids);
        gsap.set(ghost.current, { autoAlpha: 1 }); moveTarget(instance.current!);
      }),
      onDrag: function(this: Draggable) { moveTarget(this); },
      onDragEnd: safe!(() => {
        const current = session.current;
        if (!current || current.cancelled) return;
        moveTarget(instance.current!);
        if (!current.target) { returnCard(); return; }
        ghost.current!.dataset.state = 'pending';
        latest.current.onDrop(current.materials, current.target.dataset.dropFolder!);
      }),
    });
    instance.current = drag;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.isPressed) { event.preventDefault(); returnCard(); drag.endDrag(drag.pointerEvent); } };
    const cancelPointer = () => { if (drag.isPressed) { returnCard(); drag.endDrag(drag.pointerEvent); } };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointercancel', cancelPointer, true);
    document.addEventListener('touchcancel', cancelPointer, true);
    return () => { drag.kill(); instance.current = null; clearTargets(); completing.current?.(); session.current = null; setDraggingIds([]); document.removeEventListener('keydown', escape); document.removeEventListener('pointercancel', cancelPointer, true); document.removeEventListener('touchcancel', cancelPointer, true); };
  }, { scope: props.scope, dependencies: [ready, props.visible.map(item => item.id).join('|')], revertOnUpdate: true });

  const finish = contextSafe((targetId: string): Promise<void> => {
    const current = session.current;
    if (!current || !ghost.current || !card.current) return Promise.resolve();
    const target = current.target?.isConnected && current.target.dataset.dropFolder === targetId ? current.target : [...latest.current.scope.current!.querySelectorAll<HTMLElement>('[data-drop-folder]')].find(element => element.dataset.dropFolder === targetId);
    const icon = target?.querySelector('svg');
    const rect = icon?.getBoundingClientRect();
    clearTargets();
    if (!rect?.width || rect.bottom < 0 || rect.top > window.innerHeight) { cancel(); return Promise.resolve(); }
    ghost.current.dataset.state = 'storing';
    return new Promise(resolve => {
      const done = () => { completing.current = null; session.current = null; setDraggingIds([]); gsap.set(ghost.current, { autoAlpha: 0 }); gsap.set(cover.current, { autoAlpha: 0 }); resolve(); };
      completing.current = done;
      const timeline = gsap.timeline({ defaults: { ease: 'power3.inOut' }, onComplete: done });
      if (reduced()) { timeline.to(ghost.current, { autoAlpha: 0, duration: 0.1 }); return; }
      const box = ghost.current!.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - 120, y = rect.top + rect.height / 2 - 31;
      const direction = Math.atan2(rect.top + rect.height / 2 - box.top - 31, rect.left + rect.width / 2 - box.left - 120) * 180 / Math.PI;
      const angle = direction > 90 ? direction - 180 : direction < -90 ? direction + 180 : direction;
      gsap.set(cover.current, { x: rect.left, y: rect.top, scale: rect.width / 24, transformOrigin: 'top left', autoAlpha: 0 });
      timeline.to(card.current, { scaleX: 0.94, scaleY: 0.85, duration: 0.08 }, 0)
        .to(ghost.current, { x, y, rotation: angle, duration: 0.2 }, 0.08)
        .to(card.current, { x: 0, y: 0, scaleX: 1.12, scaleY: 0.38, duration: 0.1 }, 0.08)
        .to(card.current, { scaleX: 0.06, scaleY: 0.12, autoAlpha: 0, duration: 0.1 }, 0.18)
        .set(cover.current, { autoAlpha: 1 }, 0.16)
        .to(icon!, { scale: 1.12, duration: 0.1, ease: 'power3.out', transformOrigin: 'center' }, 0.08)
        .to(icon!, { scale: 1, duration: 0.1, clearProps: 'transform' }, 0.18);
    });
  });

  return { cancel, finish, draggingIds, overlay: ready ? createPortal(<>
    <div ref={ghost} className="library-drag-ghost" aria-hidden="true"><div ref={card} className="library-drag-card"><i className="library-drag-sheet"/><i className="library-drag-sheet"/><div className="library-drag-face"><FileText size={25}/><div><span ref={name}/><small ref={count}/></div></div></div><div ref={hint} className="library-drag-hint"/></div>
    <svg ref={cover} className="library-folder-cover" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h18l-2 10H5z" fill="#eaf1fb" stroke="#4474b4" strokeWidth="1.5" strokeLinejoin="round"/></svg>
  </>, document.body) : null };
}
