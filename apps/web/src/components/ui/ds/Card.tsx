import React from 'react';
import styles from './ds.module.css';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'interactive' | 'muted';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', variant = 'default', children, tabIndex, onKeyDown, onClick, ...props }, ref) => {
    const isInteractive = variant === 'interactive';
    const isActionable = Boolean(onClick);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isActionable && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        (e.currentTarget as HTMLElement).click();
      }
      onKeyDown?.(e);
    };

    const classNames = [
      styles.card,
      isInteractive || isActionable ? styles.cardInteractive : '',
      variant === 'muted' ? styles.cardMuted : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        ref={ref}
        className={classNames}
        tabIndex={isActionable ? tabIndex ?? 0 : tabIndex}
        role={isActionable ? 'button' : undefined}
        onKeyDown={isActionable ? handleKeyDown : onKeyDown}
        onClick={onClick}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', children, ...props }, ref) => (
    <div ref={ref} className={`${styles.cardHeader} ${className}`.trim()} {...props}>
      {children}
    </div>
  )
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className = '', children, ...props }, ref) => (
    <h3 ref={ref} className={`${styles.cardTitle} ${className}`.trim()} {...props}>
      {children}
    </h3>
  )
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className = '', children, ...props }, ref) => (
    <p ref={ref} className={`${styles.cardDescription} ${className}`.trim()} {...props}>
      {children}
    </p>
  )
);
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', children, ...props }, ref) => (
    <div ref={ref} className={`${styles.cardContent} ${className}`.trim()} {...props}>
      {children}
    </div>
  )
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', children, ...props }, ref) => (
    <div ref={ref} className={`${styles.cardFooter} ${className}`.trim()} {...props}>
      {children}
    </div>
  )
);
CardFooter.displayName = 'CardFooter';
