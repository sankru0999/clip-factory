import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import ClipFactory from "@/pages/clip-factory";
import { setBaseUrl } from "@workspace/api-client-react";

// Configure API base URL for deployed backend
setBaseUrl("https://clip-factory-production-93e3.up.railway.app");

const queryClient = new QueryClient();

function TabSwitcher() {
  const [location] = useLocation();
  return (
    <div className="w-full bg-background/95 backdrop-blur-md border-b border-border flex justify-center py-3 z-50 sticky top-0 md:relative md:top-auto">
      <div className="flex bg-zinc-900 p-1.5 rounded-lg border border-border/50">
        <Link 
          href="/" 
          className={`px-6 py-2 rounded-md font-display tracking-widest transition-colors ${
            location === "/" || location === "" ? "bg-primary text-black shadow-sm" : "text-muted-foreground hover:text-white"
          }`} 
          data-testid="tab-meme-factory"
        >
          MEME FACTORY
        </Link>
        <Link 
          href="/clip-factory" 
          className={`px-6 py-2 rounded-md font-display tracking-widest transition-colors ${
            location === "/clip-factory" ? "bg-primary text-black shadow-sm" : "text-muted-foreground hover:text-white"
          }`} 
          data-testid="tab-clip-factory"
        >
          CLIP FACTORY
        </Link>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/clip-factory" component={ClipFactory} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <TabSwitcher />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
