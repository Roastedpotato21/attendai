import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  PhoneCall,
  MessageSquare,
  BellRing,
  Sparkles,
  FileBarChart,
  TriangleAlert,
  GraduationCap,
  FileText,
  Plug,
  Settings,
  ShieldCheck,
  ScrollText,
  GraduationCap as Logo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { routeAuth } from "@/lib/route-auth";
import { staffRouteAllowed } from "@/lib/staff-setup";

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
      { title: "My Staff Profile", url: "/staff-profile", icon: Users },
      { title: "My Attendance", url: "/student-dashboard", icon: LayoutDashboard },
      { title: "Attendance", url: "/attendance", icon: CalendarCheck },
      { title: "Students", url: "/students", icon: Users },
      { title: "Student Import", url: "/student-import", icon: Users },
      { title: "Batches / Cohorts", url: "/cohorts", icon: GraduationCap },
      { title: "Promotion", url: "/student-promotion", icon: GraduationCap },
    ],
  },
  {
    label: "AI Communication",
    items: [
      { title: "AI Voice Calls", url: "/voice-calls", icon: PhoneCall },
      { title: "Guardian Messages", url: "/messages", icon: MessageSquare },
      { title: "Guardian Devices", url: "/guardian-devices", icon: BellRing },
      { title: "AI Insights", url: "/insights", icon: Sparkles },
      { title: "Templates", url: "/templates", icon: FileText },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Analytics & Risk", url: "/analytics", icon: FileBarChart },
      { title: "Interventions", url: "/interventions", icon: TriangleAlert },
      { title: "Escalations", url: "/escalations", icon: TriangleAlert },
      { title: "Reports", url: "/reports", icon: FileBarChart },
      { title: "Faculty & Classes", url: "/faculty", icon: GraduationCap },
    ],
  },
  {
    label: "Institution Setup",
    items: [
      { title: "Institution Profile", url: "/institution-profile", icon: Settings },
      { title: "Departments", url: "/departments", icon: GraduationCap },
      { title: "Programs & Structure", url: "/programs", icon: GraduationCap },
      { title: "Staff", url: "/staff", icon: Users },
      { title: "Roles & Assignments", url: "/staff-assignments", icon: ShieldCheck },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Integrations", url: "/integrations", icon: Plug },
      { title: "Roles & Permissions", url: "/roles", icon: ShieldCheck },
      { title: "Audit Logs", url: "/audit-logs", icon: ScrollText },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

import { useAuth } from "@/components/auth/auth-context";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { user } = useAuth();

  const role = user?.role || "student"; // Default to lowest privilege

  // Filter groups and items based on role using the centralized route-auth config
  const filteredGroups = groups
    .map((g) => {
      return {
        ...g,
        items: g.items.filter((item) => {
          if (
            !staffRouteAllowed(
              item.url,
              !!user?.staffModel,
              !!user?.canManageSetup,
              !!user?.legacyClassAccess,
            )
          )
            return false;
          const rule = routeAuth[item.url];
          if (!rule || !rule.allowedRoles) return true;
          return rule.allowedRoles.includes(role);
        }),
      };
    })
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <div className="brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded-xl">
            <Logo className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-sidebar-foreground">
                AttendAI
              </p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">
                Attendance Intelligence
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {filteredGroups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url}
                      tooltip={item.title}
                    >
                      <Link to={item.url} className="flex items-center gap-2.5">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="truncate">{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed ? (
          <div className="rounded-lg bg-sidebar-accent p-3">
            <p className="text-xs font-medium text-sidebar-accent-foreground">AttendAI</p>
            <p className="mt-1 text-[11px] leading-snug text-sidebar-foreground/60">
              Attendance and guardian notifications for your institution.
            </p>
          </div>
        ) : (
          <div className="grid h-8 place-items-center">
            <span className="h-2 w-2 rounded-full bg-warning" />
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
