import React from 'react';
import styles from './ds.module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'primary',
      size = 'md',
      type = 'button',
      iconLeft,
      iconRight,
      loading = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const variantClassName =
      styles[`btn${variant.charAt(0).toUpperCase() + variant.slice(1)}` as keyof typeof styles] || styles.btnPrimary;
    const sizeClassName =
      styles[`btn${size.charAt(0).toUpperCase() + size.slice(1)}` as keyof typeof styles] || styles.btnMd;

    const classNames = [
      styles.btn,
      variantClassName,
      sizeClassName,
      loading ? styles.loading : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type={type}
        className={classNames}
        disabled={disabled || loading}
        aria-busy={loading ? 'true' : undefined}
        {...props}
      >
        {loading && <span className={styles.spinner} aria-hidden="true" />}
        {!loading && iconLeft}
        {children}
        {iconRight}
      </button>
    );
  }
);

Button.displayName = 'Button';
