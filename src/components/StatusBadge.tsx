import { AlertCircle, CheckCircle2, Loader2, PauseCircle } from 'lucide-react';
import type { ComponentType } from 'react';

type StatusVariant = 'completed' | 'pending' | 'syncing' | 'error';

interface StatusBadgeProps {
    variant: StatusVariant;
    label?: string;
    className?: string;
}

const STYLE_MAP: Record<StatusVariant, { text: string; className: string; icon: ComponentType<{ className?: string }> }> = {
    completed: {
        text: '已完成',
        className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        icon: CheckCircle2,
    },
    pending: {
        text: '未填写',
        className: 'bg-slate-100 text-slate-600 border border-slate-200',
        icon: PauseCircle,
    },
    syncing: {
        text: '同步中',
        className: 'bg-blue-50 text-blue-700 border border-blue-200',
        icon: Loader2,
    },
    error: {
        text: '同步异常',
        className: 'bg-rose-50 text-rose-700 border border-rose-200',
        icon: AlertCircle,
    },
};

export default function StatusBadge({ variant, label, className = '' }: StatusBadgeProps) {
    const style = STYLE_MAP[variant];
    const Icon = style.icon;
    const isSyncing = variant === 'syncing';

    return (
        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold ${style.className} ${className}`.trim()}>
            <Icon className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {label || style.text}
        </span>
    );
}
