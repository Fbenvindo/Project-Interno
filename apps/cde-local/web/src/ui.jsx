// Componentes básicos da interface (cartão, botão, campo, selo), no mesmo visual do sistema de gestão.
import React from 'react';

const cx = (...c) => c.filter(Boolean).join(' ');
/** Junta classes deixando a largura/altura passada em `className` vencer a padrão. */
const merge = (base, className = '') => {
  const has = (prefix) => new RegExp(`(^|\\s)${prefix}-`).test(className);
  return cx(
    base
      .split(' ')
      .filter((c) => !(c.startsWith('w-') && has('w')) && !(c.startsWith('h-') && has('h')))
      .join(' '),
    className,
  );
};

export const Card = ({ className, ...p }) => <div className={cx('rounded-lg border border-gray-200 bg-white shadow-sm', className)} {...p} />;
export const CardHeader = ({ className, ...p }) => <div className={cx('space-y-1.5 p-4', className)} {...p} />;
export const CardTitle = ({ className, ...p }) => <h3 className={cx('font-semibold leading-none tracking-tight', className)} {...p} />;
export const CardContent = ({ className, ...p }) => <div className={cx('p-4 pt-0', className)} {...p} />;

export function Button({ className, variant = 'default', size = 'md', ...p }) {
  const v = {
    default: 'bg-gray-900 text-white hover:bg-gray-800',
    outline: 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-800',
    ghost: 'hover:bg-gray-100 text-gray-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }[variant];
  const s = { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4 text-sm' }[size] || 'h-9 px-4 text-sm';
  return <button className={cx('inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none', v, s, className)} {...p} />;
}

export const Input = React.forwardRef(({ className, ...p }, ref) => (
  <input ref={ref} className={merge('h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-500', className)} {...p} />
));

export const Badge = ({ className, ...p }) => <span className={cx('inline-flex items-center rounded-md border border-gray-300 px-2 py-0.5 text-xs font-semibold', className)} {...p} />;

export const Field = ({ label, children, className }) => (
  <label className={cx('flex flex-col gap-1', className)}>
    <span className="text-xs text-gray-500">{label}</span>
    {children}
  </label>
);
