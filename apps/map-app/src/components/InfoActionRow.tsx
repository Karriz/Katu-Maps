import type { LucideIcon } from 'lucide-react';

export type InfoAction = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  tone?: 'primary' | 'secondary';
  iconOnly?: boolean;
  disabled?: boolean;
};

export function InfoActionRow({ actions, className }: { actions: InfoAction[]; className?: string }) {
  return (
    <div className={`info-action-row${className ? ` ${className}` : ''}`}>
      {actions.map(({ label, icon: Icon, onClick, tone = 'secondary', iconOnly = false, disabled = false }) => (
        <button
          className={`info-action-button ${tone}${iconOnly ? ' icon-only' : ''}`}
          key={label}
          type="button"
          aria-label={iconOnly ? label : undefined}
          title={iconOnly ? label : undefined}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon aria-hidden="true" />
          {!iconOnly && label}
        </button>
      ))}
    </div>
  );
}
