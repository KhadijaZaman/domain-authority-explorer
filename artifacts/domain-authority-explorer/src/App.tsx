import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import Home from '@/pages/Home';
import Compare from '@/pages/Compare';
import Leaderboard from '@/pages/Leaderboard';
import LinkGap from '@/pages/LinkGap';
import Cheatsheet from '@/pages/Cheatsheet';
import CorpusAudit from '@/pages/CorpusAudit';
import Methodology from '@/pages/Methodology';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/compare" component={Compare} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/gap" component={LinkGap} />
      <Route path="/corpus" component={CorpusAudit} />
      <Route path="/cheatsheet" component={Cheatsheet} />
      <Route path="/methodology" component={Methodology} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
