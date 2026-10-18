'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './button';
import type { ReactNode } from 'react';

export function Modal({ open, onOpenChange, title, description, children, error, wide = false }: { open: boolean; onOpenChange: (value: boolean) => void; title: string; description: string; children: ReactNode; error?: string; wide?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`modal ${wide ? 'modal-wide' : ''}`}>
    <header className="modal-header"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭窗口"><X size={19} /></Button></Dialog.Close></header>
    {error && <p className="modal-error" role="alert">{error}</p>}
    {children}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
