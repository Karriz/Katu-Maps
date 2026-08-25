import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Button({ className, variant = 'ghost', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'outline';
}) {
  return (
    <button
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50',
        variant === 'outline'
          ? 'border border-slate-200 bg-white hover:bg-slate-50'
          : 'hover:bg-slate-100',
        className,
      )}
      {...props}
    />
  );
}
