import React from 'react';
import styles from './ds.module.css';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'danger' | 'primary';
  size?: 'sm' | 'md' | 'lg';
  'aria-label': string; // Acessibilidade obrigatória para botões de ícone sem texto visível
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className = '',
      variant = 'default',
      size = 'md',
      type = 'button',
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    let variantStyle = styles.btnSecondary;
    if (variant === 'ghost') variantStyle = styles.btnGhost;
    else if (variant === 'danger') variantStyle = styles.btnDanger;
    else if (variant === 'primary') variantStyle = styles.btnPrimary;

    const sizeStyle =
      styles[`iconBtn${size.charAt(0).toUpperCase() + size.slice(1)}` as keyof typeof styles] || styles.iconBtnMd;

    const classNames = [
      styles.iconBtn,
      variantStyle,
      sizeStyle,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type={type}
        className={classNames}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
