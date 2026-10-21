import type { ReactNode } from "react";
import { Bell, Search } from "lucide-react";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-context";
import { roleLabels } from "@/lib/staff-setup";
import { LogOut } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 glass-panel flex h-16 items-center gap-3 border-b px-3 sm:px-5">
            <SidebarTrigger />
            <div className="relative hidden min-w-0 flex-1 md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search students, parents, calls…" className="h-9 max-w-sm pl-9" />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Badge
                variant="outline"
                className="hidden border-warning/40 text-warning sm:inline-flex"
              >
                Simulation
              </Badge>
              <ThemeToggle />
              <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
              </Button>
              {user && (
                <div className="flex items-center gap-3 pl-2 border-l ml-2">
                  <div className="hidden flex-col items-end sm:flex">
                    <span className="text-sm font-medium leading-none">{user.name}</span>
                    <span className="max-w-xs truncate text-xs text-muted-foreground">
                      {user.setupRoles?.map((role) => roleLabels[role] ?? role).join(", ") ??
                        user.role}
                    </span>
                  </div>
                  <Avatar className="h-8 w-8 border">
                    <AvatarFallback className="bg-primary/10 text-xs text-primary">
                      {user.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <Button variant="ghost" size="icon" onClick={logout} title="Logout">
                    <LogOut className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </Button>
                </div>
              )}
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6">{children}</main>
          <footer className="flex justify-center gap-4 border-t px-4 py-3 text-xs text-muted-foreground">
            <Link to="/privacy" className="hover:underline">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:underline">
              Terms & Conditions
            </Link>
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}
