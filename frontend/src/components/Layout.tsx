import { Outlet, NavLink } from "react-router-dom";
import { StickyNote, LayoutDashboard, CalendarDays, Sun, Moon, Menu, LogOut } from "lucide-react";
import { useUIStore } from "../store/uiStore";
import { useAuthStore } from "../store/authStore";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { cn } from "../lib/utils";

const navItems = [
  { to: "/notes", label: "Notes", icon: StickyNote },
  { to: "/kanban", label: "Kanban", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
] as const;

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const logout = useAuthStore((s) => s.logout);

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      {/* Logo / title */}
      <div className="mb-4 flex items-center gap-2 px-2">
        <StickyNote className="size-5 text-primary" />
        <span className="font-heading text-base font-semibold">Agented Notes</span>
      </div>

      {/* Navigation links */}
      <div className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavClick}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )
            }
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theme toggle */}
      <Button
        variant="ghost"
        className="justify-start gap-3"
        onClick={toggleTheme}
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </Button>

      {/* Logout */}
      <Button
        variant="ghost"
        className="justify-start gap-3 text-muted-foreground hover:text-destructive"
        onClick={logout}
      >
        <LogOut className="size-4" />
        Sign out
      </Button>
    </nav>
  );
}

export default function Layout() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* Mobile: Sheet-based sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="fixed left-3 top-3 z-40 md:hidden"
              aria-label="Toggle navigation"
            >
              <Menu className="size-5" />
            </Button>
          }
        />
        <SheetContent side="left" className="w-64 p-0">
          <SidebarContent onNavClick={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Desktop: fixed sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:block">
        <SidebarContent />
      </aside>

      {/* Main content area */}
      <main className="flex flex-1 flex-col overflow-auto pt-14 md:pt-0">
        {/* Mobile top spacer for hamburger */}
        <div className="h-0 md:hidden" />
        <Outlet />
      </main>
    </div>
  );
}
