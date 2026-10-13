import React from 'react';
import { Menu, Search, Bell, Moon, Sun, LogOut, ChevronDown, User as UserIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/store/useAuthStore';
import { IconButton } from '@/components/ui/ds';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
import styles from './layout.module.css';

interface AppTopbarDsProps {
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
}

export function AppTopbarDs({ onToggleSidebar, sidebarExpanded }: AppTopbarDsProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { user, currentOrganization, logout } = useAuthStore();
  const navigate = useNavigate();

  const isDark = resolvedTheme === 'dark';

  // Detecção segura de atalho por plataforma (Ctrl+K no Windows/Linux, ⌘K no macOS)
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform);
  const searchShortcut = isMac ? '⌘K' : 'Ctrl+K';

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userInitials = user?.name
    ? user.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'ZH';

  const roleLabel =
    user?.role === 'admin'
      ? 'Painel Admin'
      : user?.role === 'manager'
      ? 'Painel Gestão'
      : 'Membro';

  return (
    <header className={styles.topbar}>
      {/* 1. Lado Esquerdo: Toggle de Sidebar e Busca Global */}
      <div className={styles.topbarLeft}>
        <button
          type="button"
          onClick={onToggleSidebar}
          className={styles.toggleBtn}
          aria-label={sidebarExpanded ? 'Recolher menu lateral' : 'Expandir menu lateral'}
          title={sidebarExpanded ? 'Recolher menu lateral' : 'Expandir menu lateral'}
        >
          <Menu size={18} />
        </button>

        <div className={styles.searchBox} role="search">
          <Search size={15} aria-hidden="true" />
          <input
            type="text"
            placeholder="Busca global — em breve"
            className={styles.searchInput}
            readOnly
            disabled
            aria-label="Busca global — em breve"
            title="Busca global — em breve na Fase 3.5"
          />
          <kbd className={styles.searchShortcut} aria-hidden="true">{searchShortcut}</kbd>
        </div>
      </div>

      {/* 2. Lado Direito: Contexto, Ações Globais e Usuário */}
      <div className={styles.topbarRight}>
        {/* Badge de Contexto Administrativo / Organização */}
        <div className={styles.adminBadge} title={currentOrganization?.name || 'Workspace'}>
          <span className={styles.adminDot} aria-hidden="true" />
          <span>{currentOrganization?.name ? `${currentOrganization.name} · ${roleLabel}` : roleLabel}</span>
        </div>

        {/* Toggle Real de Tema Light/Dark */}
        <IconButton
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
          title={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
        >
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
        </IconButton>

        {/* Notificações (Sem dados simulados e sem badge de não lido) */}
        <button
          type="button"
          className={styles.notificationBtn}
          aria-label="Notificações — em breve"
          title="Notificações — em breve"
          disabled
        >
          <Bell size={17} />
        </button>

        {/* Menu do Usuário Real com Dropdown para Logout */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div
              className={styles.topbarUserMenu}
              role="button"
              tabIndex={0}
              aria-label="Menu da conta do usuário"
            >
              <div className={styles.topbarAvatar}>
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name || 'Avatar'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  userInitials
                )}
              </div>
              <div className={styles.topbarUserInfo}>
                <span className={styles.topbarUserName}>{user?.name || 'Usuário'}</span>
                <span className={styles.topbarUserRole}>{user?.email || 'Autenticado'}</span>
              </div>
              <ChevronDown size={14} color="var(--z-text-muted)" aria-hidden="true" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-[var(--z-surface-card)] border-[var(--z-border-default)] text-[var(--z-text-primary)]">
            <div className="px-3 py-2 text-xs">
              <p className="font-semibold">{user?.name}</p>
              <p className="text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator className="bg-[var(--z-border-default)]" />
            <DropdownMenuItem
              onClick={() => navigate('/configuracoes')}
              className="cursor-pointer hover:bg-[var(--z-surface-hover)] focus:bg-[var(--z-surface-hover)]"
            >
              <UserIcon className="mr-2 h-4 w-4" />
              Minha Conta
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-red-400 focus:text-red-300 focus:bg-red-950/20 cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair da conta
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
