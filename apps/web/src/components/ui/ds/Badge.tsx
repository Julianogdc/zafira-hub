import React from 'react';
import styles from './ds.module.css';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'neutral' | 'purple' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className = '',
      variant = 'neutral',
      size = 'sm',
      children,
      ...props
    },
    ref
  ) => {
    const variantKey = variant === 'primary' ? 'Purple' : variant.charAt(0).toUpperCase() + variant.slice(1);
    const variantStyle =
      styles[`badge${variantKey}` as keyof typeof styles] || styles.badgeNeutral;
    const sizeStyle =
      styles[`badge${size.charAt(0).toUpperCase() + size.slice(1)}` as keyof typeof styles] || styles.badgeSm;

    const classNames = [
      styles.badge,
      variantStyle,
      sizeStyle,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <span ref={ref} className={classNames} {...props}>
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
