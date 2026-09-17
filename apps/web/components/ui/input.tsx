'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  required?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, leftIcon, required, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={fieldId} className="text-caption font-medium text-ink-80">
        {label}
        {required && <span className="ml-1 text-feedback-danger">*</span>}
      </label>
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-ink-40">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            'h-11 w-full rounded-md border bg-bg-elevated px-sm text-body text-ink-100 placeholder:text-ink-40',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-accent-700/30',
            leftIcon && 'pl-10',
            error ? 'border-feedback-danger' : 'border-border-divider focus:border-accent-700',
            className,
          )}
          {...props}
        />
      </div>
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-caption text-feedback-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-caption text-ink-40">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, options, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={fieldId} className="text-caption font-medium text-ink-80">
        {label}
        {required && <span className="ml-1 text-feedback-danger">*</span>}
      </label>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={!!error}
        className={cn(
          'h-11 w-full rounded-md border bg-bg-elevated px-sm text-body text-ink-100',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-accent-700/30',
          error ? 'border-feedback-danger' : 'border-border-divider focus:border-accent-700',
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-caption text-feedback-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-ink-40">{hint}</p>
      ) : null}
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }
>(function Textarea({ label, hint, error, className, id, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={fieldId} className="text-caption font-medium text-ink-80">
        {label}
      </label>
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={!!error}
        className={cn(
          'min-h-[120px] w-full rounded-md border bg-bg-elevated p-sm text-body text-ink-100 placeholder:text-ink-40',
          'font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-accent-700/30',
          error ? 'border-feedback-danger' : 'border-border-divider focus:border-accent-700',
          className,
        )}
        {...props}
      />
      {error ? (
        <p role="alert" className="text-caption text-feedback-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-ink-40">{hint}</p>
      ) : null}
    </div>
  );
});
