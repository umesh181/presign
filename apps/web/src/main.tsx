import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css"; // first: the landing page's own CSS must be able to override shared rules
import { AppPage } from "./App.tsx";
import { Landing } from "./landing/Landing.tsx";

/** "#/app" = the app, anything else = the landing page. Hash routing works on any static host. */
function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.startsWith("#/app") ? <AppPage /> : <Landing onLaunch={() => (location.hash = "#/app")} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
