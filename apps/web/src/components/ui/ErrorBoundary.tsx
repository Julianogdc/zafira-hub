import React from "react";
import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary";
import { ErrorState } from "@/components/ui/ds";

interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

function ErrorFallback({ resetErrorBoundary }: ErrorFallbackProps) {
  return (
    <ErrorState
      fullHeight
      title="Ops, algo deu errado!"
      description="Ocorreu um erro inesperado ao processar esta área. Tente recarregar a página ou tente novamente."
      onRetry={resetErrorBoundary}
      onReload={() => window.location.reload()}
    />
  );
}

export interface GlobalErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

export function GlobalErrorBoundary({ children, onReset }: GlobalErrorBoundaryProps) {
  return (
    <ReactErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={onReset}
    >
      {children}
    </ReactErrorBoundary>
  );
}
