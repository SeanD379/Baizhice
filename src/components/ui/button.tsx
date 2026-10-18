import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'normal' | 'icon' };
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ className, variant = 'secondary', size = 'normal', type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={twMerge(clsx('btn', `btn-${variant}`, `btn-${size}`, className))} {...props} />;
});
