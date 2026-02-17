import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Sidebar } from "@/components/layout/Sidebar"

export function Header() {

  return (
    <div className="border-b bg-background/80 backdrop-blur">
      <div className="flex h-16 items-center px-4">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" className="md:hidden">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0">
            <Sidebar className="block w-full border-r-0" />
          </SheetContent>
        </Sheet>
        <div className="ml-auto flex items-center space-x-4" />
      </div>
    </div>
  )
}
