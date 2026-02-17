import { LayoutDashboard, Settings as SettingsIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Link, useLocation } from "react-router-dom"

type SidebarProps = React.HTMLAttributes<HTMLDivElement>

export function Sidebar({ className }: SidebarProps) {
  const location = useLocation();
  const path = location.pathname;

  return (
    <div className={cn("pb-12 w-64 border-r h-full bg-background/95 backdrop-blur hidden md:block", className)}>
      <div className="space-y-4 py-6">
        <div className="px-3 py-2">
          <h2 className="mb-6 px-4 text-lg font-semibold tracking-tight">
            Resume Tower
          </h2>
          <div className="space-y-1">
            <Link to="/">
              <Button variant={path === "/" ? "secondary" : "ghost"} className="w-full justify-start rounded-xl">
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Dashboard
              </Button>
            </Link>
            <Link to="/settings">
              <Button variant={path === "/settings" ? "secondary" : "ghost"} className="w-full justify-start rounded-xl">
                <SettingsIcon className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
