import { useEffect, useSyncExternalStore } from 'react';
import { Home } from './features/home/Home.tsx';
import { ItemPage } from './features/items/ItemPage.tsx';
import { Lessons } from './features/lessons/Lessons.tsx';
import { Reviews } from './features/reviews/Reviews.tsx';
import { Settings } from './features/settings/Settings.tsx';
import { applyUpdate, updateReady } from './pwa/register.ts';
import { useRoute } from './router.ts';
import { useApp } from './state/hooks.ts';
import { applyTheme } from './theme/theme.ts';

export function App(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const theme = app.derived?.settings.theme ?? app.bootTheme;
  useEffect(() => applyTheme(theme), [theme]);
  const update = useSyncExternalStore(updateReady.subscribe, updateReady.get);

  let body: JSX.Element;
  if (app.status === 'loading') body = <div className="page narrow"><p className="muted" aria-busy="true">불러오는 중…</p></div>;
  else if (app.status === 'error') body = <div className="page narrow"><h1>Couldn't start</h1><p>{app.error}</p></div>;
  else {
    switch (route.name) {
      case 'home': body = <Home />; break;
      case 'lessons': body = <Lessons />; break;
      case 'reviews': body = <Reviews />; break;
      case 'settings': body = <Settings />; break;
      case 'item': body = <ItemPage key={route.id} id={route.id} />; break;
      default: body = <div className="page narrow"><h1>Not found</h1><a href="#/">Home</a></div>;
    }
  }
  const inSession = route.name === 'reviews' || route.name === 'lessons';
  return (
    <>
      {app.persistError && <div className="banner banner-error" role="alert">{app.persistError}</div>}
      <main data-route={route.name}>{body}</main>
      {update && (
        <div className="toast" role="status" data-testid="update-toast">
          <span>{inSession ? 'Update ready. Reload when you finish.' : 'Update ready.'}</span>
          <button type="button" className="btn btn-small" onClick={applyUpdate}>Reload</button>
        </div>
      )}
    </>
  );
}
