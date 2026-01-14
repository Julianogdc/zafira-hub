import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { LayoutDashboard, Settings2, Sparkles, Target, Users2, Wallet2, Wrench, Briefcase, Megaphone, Lock, TrendingUp } from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

type SidebarItem = {
  label: string;
  href: string;
  icon: any; // LucideIcon type is complex to import directly without extra deps, keeping simple or using any for icon specifically if needed, but better to infer.
  adminOnly?: boolean;
  locked?: boolean;
};

const items = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Finanças", href: "/financas", icon: Wallet2 },
  { label: "Clientes", href: "/clientes", icon: Users2 },
  { label: "Projetos", href: "/projetos", icon: Briefcase, locked: true },
  { label: "Metas", href: "/metas", icon: Target },
  { label: "Comercial", href: "/crm", icon: Megaphone },
  // { label: "Performance", href: "/performance", icon: TrendingUp },
  { label: "Ferramentas", href: "/ferramentas", icon: Wrench },
  { label: "IA Studio", href: "/ia-studio", icon: Sparkles },
  { label: "Configurações", href: "/configuracoes", icon: Settings2 },
  { label: "Usuários", href: "/admin/users", icon: Users2, adminOnly: true },
] as const;

import { useAuthStore } from "@/store/useAuthStore";
import { LogOut, User as UserIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/70 bg-sidebar/95 backdrop-blur-2xl">
      <SidebarRail />
      {/* Internal Toggle Button */}
      <SidebarTrigger className="absolute -right-3 top-1/2 -translate-y-1/2 z-50 h-6 w-6 rounded-full border bg-zinc-800 shadow-md hover:bg-zinc-700 text-zinc-400" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/70">
            Navegação
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items
                .filter(item => {
                  // Admin sees everything
                  if (user?.role === 'admin') return true;

                  // Hide Admin Only items for non-admins (Managers also cannot see these)
                  if ((item as any).adminOnly && user?.role !== 'admin') return false; // Fixed logic to safely check adminOnly

                  // Manager sees everything else (Business Routes)
                  if (user?.role === 'manager') return true;

                  // Member specific restrictions (Legacy hardcoded checks)
                  if (item.href === '/financas') return false;
                  if (item.href === '/clientes') return false;
                  if (item.href === '/crm') return false;
                  if (item.href === '/performance') return false;
                  return true;
                })
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPath === item.href;

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} size="lg" className="group-data-[collapsible=icon]:justify-center">
                        <NavLink
                          to={item.href}
                          aria-label={item.label}
                          onClick={(e) => {
                            if ((item as any).locked) {
                              e.preventDefault();
                              toast.info("Em breve", {
                                description: "Integração com Asana para gestão de projetos chegará na próxima atualização."
                              });
                            }
                          }}
                        >
                          <Icon className="mr-2 h-4 w-4 group-data-[collapsible=icon]:mr-0 group-data-[collapsible=icon]:size-6" />
                          <span className="truncate text-sm group-data-[collapsible=icon]:hidden">{item.label}</span>
                          {(item as any).locked && (
                            <Lock className="ml-auto h-3 w-3 opacity-50 group-data-[collapsible=icon]:hidden" />
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/70 bg-sidebar/80 p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} tooltip="Sair da conta" size="lg" className="text-red-400 hover:text-red-300 hover:bg-red-950/20 group-data-[collapsible=icon]:justify-center">
              <LogOut className="mr-2 h-4 w-4 group-data-[collapsible=icon]:mr-0 group-data-[collapsible=icon]:size-6" />
              <span className="truncate text-sm group-data-[collapsible=icon]:hidden">Sair da conta</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 group-data-[collapsible=icon]:mr-0">
                    {user?.avatar ? <img src={user.avatar} className="h-full w-full rounded-lg" /> : <UserIcon className="h-4 w-4" />}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">{user?.name}</span>
                    <span className="truncate text-xs">{user?.email}</span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg bg-sidebar p-0 text-sidebar-foreground border-sidebar-border" side="right" align="end" sideOffset={4}>
                <DropdownMenuItem onClick={handleLogout} className="text-red-400 focus:text-red-300">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair da conta
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar >
  );
}