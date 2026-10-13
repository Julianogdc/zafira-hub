import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  UsersRound,
  PanelsTopLeft,
  Target,
  WalletCards,
  Megaphone,
  Briefcase,
  ListChecks,
  CalendarDays,
  Wrench,
  Sparkles,
  Settings,
  ShieldCheck,
  LogOut,
  Lock,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { toast } from 'sonner';
import { useOnboardingCapabilities } from '@/services/onboardingCapabilities';
import { useCalendarCapabilities } from '@/services/calendar';
import { useContentCapabilities } from '@/services/content';
import { isNavItemVisible } from '@/lib/onboarding-execution-view';
import styles from './layout.module.css';

interface AppSidebarDsProps {
  expanded: boolean;
}

interface NavItemConfig {
  to: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  managerOnly?: boolean;
  memberRestricted?: boolean;
  locked?: boolean;
  /** Capacidade exigida para exibir o item (a protecao real das rotas e do backend permanece). */
  requires?: 'onboarding.view' | 'calendar.view' | 'content.view';
}

export function AppSidebarDs({ expanded }: AppSidebarDsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, currentOrganization } = useAuthStore();
  const onboardingCaps = useOnboardingCapabilities(currentOrganization?.id);
  const calendarCaps = useCalendarCapabilities(currentOrganization?.id);
  const contentCaps = useContentCapabilities(currentOrganization?.id);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navGroups: { title: string; items: NavItemConfig[] }[] = [
    {
      title: 'Visão',
      items: [
        { to: '/', label: 'Início', icon: <LayoutDashboard size={17} /> },
        { to: '/clientes', label: 'Clientes', icon: <UsersRound size={17} />, memberRestricted: true },
        { to: '/conteudos', label: 'Conteúdos & Agenda', icon: <PanelsTopLeft size={17} />, memberRestricted: true },
        { to: '/metas', label: 'Metas', icon: <Target size={17} /> },
      ],
    },
    {
      title: 'Operação',
      items: [
        { to: '/financas', label: 'Finanças', icon: <WalletCards size={17} />, memberRestricted: true },
        { to: '/crm', label: 'Comercial', icon: <Megaphone size={17} />, memberRestricted: true },
        { to: '/projetos', label: 'Projetos', icon: <Briefcase size={17} /> },
        { to: '/onboarding', label: 'Onboarding', icon: <ListChecks size={17} />, requires: 'onboarding.view' },
        { to: '/agenda', label: 'Agenda', icon: <CalendarDays size={17} />, requires: 'calendar.view' },
        { to: '/conteudo', label: 'Arquivos de conteúdo', icon: <PanelsTopLeft size={17} />, requires: 'content.view' },
        { to: '/ferramentas', label: 'Ferramentas', icon: <Wrench size={17} /> },
        { to: '/ia-studio', label: 'IA Studio', icon: <Sparkles size={17} /> },
      ],
    },
    {
      title: 'Sistema',
      items: [
        { to: '/configuracoes', label: 'Configurações', icon: <Settings size={17} /> },
        { to: '/admin/users', label: 'Usuários', icon: <ShieldCheck size={17} />, adminOnly: true },
      ],
    },
  ];

  // Filtro RBAC idêntico à regra consolidada do Hub real
  const filterItemByRole = (item: NavItemConfig) => {
    // Item com capacidade exigida: oculto enquanto carrega e sem permissao (negacao por padrao)
    if (!isNavItemVisible(item, { view: onboardingCaps.view, calendarView: calendarCaps.view, contentView: contentCaps.view })) return false;
    if (user?.role === 'admin') return true;
    if (item.adminOnly) return false;
    if (user?.role === 'manager') return true;
    if (item.memberRestricted) return false;
    return true;
  };

  // Extração segura de iniciais do usuário real
  const userInitials = user?.name
    ? user.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'ZH';

  const userRoleLabel =
    user?.role === 'admin'
      ? 'Administrador'
      : user?.role === 'manager'
      ? 'Gestor'
      : 'Membro';

  return (
    <aside
      className={styles.sidebar}
      data-expanded={expanded}
      aria-label="Menu principal de navegação"
    >
      {/* 1. Área de Marca */}
      <div className={styles.logoArea}>
        <div className={styles.brandEmblem} title="Zafira Hub 2.1">
          Z
        </div>
        {expanded && (
          <div className={styles.brandTextGroup}>
            <div className={styles.brandName}>
              ZAFIRA <span style={{ opacity: 0.85, fontWeight: 500 }}>HUB</span>
              <span className={styles.brandTag}>2.1</span>
            </div>
            <span className={styles.brandSub}>Workspace da Agência</span>
          </div>
        )}
      </div>

      {/* 2. Menu com Grupos Estruturados */}
      <nav className={styles.navMenu} aria-label="Navegação do sistema">
        {navGroups.map((group, groupIdx) => {
          const visibleItems = group.items.filter(filterItemByRole);
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.title} className={styles.navGroup}>
              {groupIdx > 0 && !expanded && <div className={styles.navGroupDivider} />}
              <div className={styles.navGroupTitle}>{group.title}</div>

              {visibleItems.map((item) => {
                const isActive =
                  item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

                return (
                  <div key={item.to} className={styles.navItemWrapper}>
                    <NavLink
                      to={item.to}
                      className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      title={!expanded ? item.label : undefined}
                      onClick={(e) => {
                        if (item.locked) {
                          e.preventDefault();
                          toast.info('Em breve', {
                            description:
                              'Integração oficial Asana em consolidação nas próximas etapas.',
                          });
                        }
                      }}
                    >
                      <div className={styles.navIcon}>{item.icon}</div>
                      <span className={styles.navLabel}>{item.label}</span>
                      {item.locked && (
                        <Lock
                          size={12}
                          style={{ marginLeft: 'auto', opacity: 0.6 }}
                          aria-label="Recurso bloqueado"
                        />
                      )}
                    </NavLink>
                    {!expanded && <div className={styles.tooltip}>{item.label}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* 3. Rodapé do Usuário Real */}
      <div className={styles.footerMenu}>
        <div className={styles.userProfileCard}>
          <div className={styles.sidebarAvatar}>
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.name || 'Avatar do usuário'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              userInitials
            )}
            <span className={styles.sidebarAvatarStatus} />
          </div>

          {expanded && (
            <>
              <div className={styles.sidebarUserInfo}>
                <span className={styles.sidebarUserName}>
                  {user?.name || 'Usuário'}
                </span>
                <span className={styles.sidebarUserRole}>{userRoleLabel}</span>
              </div>

              <div className={styles.sidebarUserActions}>
                <button
                  type="button"
                  className={styles.sidebarLogoutBtn}
                  onClick={handleLogout}
                  title="Sair da conta"
                  aria-label="Sair da conta"
                >
                  <LogOut size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
