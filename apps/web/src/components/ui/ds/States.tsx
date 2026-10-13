import React from 'react';
import { Inbox, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from './Button';
import styles from './states.module.css';

/* ==========================================================================
   1. LOADING STATE
   ========================================================================== */
export interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  fullHeight?: boolean;
  className?: string;
}

export function LoadingState({
  message = 'Carregando...',
  size = 'md',
  fullHeight = false,
  className = '',
}: LoadingStateProps) {
  const spinnerSizeClass =
    size === 'sm'
      ? styles.loadingSpinnerSm
      : size === 'lg'
      ? styles.loadingSpinnerLg
      : styles.loadingSpinnerMd;

  const containerClasses = [
    styles.loadingContainer,
    fullHeight ? styles.loadingFullHeight : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses} role="status" aria-live="polite">
      <span
        className={`${styles.loadingSpinner} ${spinnerSizeClass}`}
        aria-hidden="true"
      />
      {message && (
        <span
          className={`${styles.loadingMessage} ${
            size === 'sm' ? styles.loadingMessageSm : ''
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}

/* ==========================================================================
   2. EMPTY STATE
   ========================================================================== */
export interface StateAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  primaryAction?: StateAction;
  secondaryAction?: StateAction;
  compact?: boolean;
  fullHeight?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  compact = false,
  fullHeight = false,
  className = '',
  children,
}: EmptyStateProps) {
  const defaultIcon = (
    <Inbox
      size={compact ? 28 : 40}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );

  const containerClasses = [
    styles.stateContainer,
    compact ? styles.stateContainerCompact : '',
    fullHeight ? styles.stateContainerFullHeight : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const iconClasses = [
    styles.iconWrapper,
    styles.iconWrapperEmpty,
    compact ? styles.iconWrapperCompact : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses}>
      <div className={iconClasses}>
        {icon ?? defaultIcon}
      </div>

      <h3
        className={`${styles.title} ${
          compact ? styles.titleCompact : ''
        }`}
      >
        {title}
      </h3>

      {description && (
        <p
          className={`${styles.description} ${
            compact ? styles.descriptionCompact : ''
          }`}
        >
          {description}
        </p>
      )}

      {(primaryAction || secondaryAction) && (
        <div
          className={`${styles.actions} ${
            compact ? styles.actionsCompact : ''
          }`}
        >
          {secondaryAction && (
            <Button
              variant="secondary"
              size={compact ? 'sm' : 'md'}
              iconLeft={secondaryAction.icon}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
          {primaryAction && (
            <Button
              variant="primary"
              size={compact ? 'sm' : 'md'}
              iconLeft={primaryAction.icon}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

/* ==========================================================================
   3. ERROR STATE
   ========================================================================== */
export interface ErrorStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  onRetry?: () => void;
  onReload?: () => void;
  compact?: boolean;
  fullHeight?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function ErrorState({
  icon,
  title = 'Ops, algo deu errado!',
  description = 'Não foi possível carregar as informações. Tente novamente.',
  onRetry,
  onReload,
  compact = false,
  fullHeight = false,
  className = '',
  children,
}: ErrorStateProps) {
  const defaultIcon = (
    <AlertTriangle
      size={compact ? 28 : 40}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );

  const containerClasses = [
    styles.stateContainer,
    compact ? styles.stateContainerCompact : '',
    fullHeight ? styles.stateContainerFullHeight : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const iconClasses = [
    styles.iconWrapper,
    styles.iconWrapperError,
    compact ? styles.iconWrapperCompact : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses} role="alert">
      <div className={iconClasses}>
        {icon ?? defaultIcon}
      </div>

      <h3
        className={`${styles.title} ${
          compact ? styles.titleCompact : ''
        }`}
      >
        {title}
      </h3>

      {description && (
        <p
          className={`${styles.description} ${
            compact ? styles.descriptionCompact : ''
          }`}
        >
          {description}
        </p>
      )}

      {(onRetry || onReload) && (
        <div
          className={`${styles.actions} ${
            compact ? styles.actionsCompact : ''
          }`}
        >
          {onReload && (
            <Button
              variant="secondary"
              size={compact ? 'sm' : 'md'}
              onClick={onReload}
            >
              Recarregar Página
            </Button>
          )}
          {onRetry && (
            <Button
              variant="primary"
              size={compact ? 'sm' : 'md'}
              onClick={onRetry}
            >
              Tentar Novamente
            </Button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

/* ==========================================================================
   4. PERMISSION STATE
   ========================================================================== */
export interface PermissionStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  onBack?: () => void;
  action?: StateAction;
  compact?: boolean;
  fullHeight?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function PermissionState({
  icon,
  title = 'Acesso Restrito',
  description = 'Você não tem permissão para visualizar esta área.',
  onBack,
  action,
  compact = false,
  fullHeight = false,
  className = '',
  children,
}: PermissionStateProps) {
  const defaultIcon = (
    <ShieldAlert
      size={compact ? 28 : 40}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );

  const containerClasses = [
    styles.stateContainer,
    compact ? styles.stateContainerCompact : '',
    fullHeight ? styles.stateContainerFullHeight : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const iconClasses = [
    styles.iconWrapper,
    styles.iconWrapperPermission,
    compact ? styles.iconWrapperCompact : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses}>
      <div className={iconClasses}>
        {icon ?? defaultIcon}
      </div>

      <h3
        className={`${styles.title} ${
          compact ? styles.titleCompact : ''
        }`}
      >
        {title}
      </h3>

      {description && (
        <p
          className={`${styles.description} ${
            compact ? styles.descriptionCompact : ''
          }`}
        >
          {description}
        </p>
      )}

      {(onBack || action) && (
        <div
          className={`${styles.actions} ${
            compact ? styles.actionsCompact : ''
          }`}
        >
          {onBack && (
            <Button
              variant="secondary"
              size={compact ? 'sm' : 'md'}
              onClick={onBack}
            >
              Voltar
            </Button>
          )}
          {action && (
            <Button
              variant="primary"
              size={compact ? 'sm' : 'md'}
              iconLeft={action.icon}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
