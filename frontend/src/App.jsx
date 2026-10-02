import { useState } from "react";
import DetectionView from "./pages/DetectionView.jsx";
import HistoryView from "./pages/HistoryView.jsx";

const PAGES = {
  detect: { label: "Detect", Component: DetectionView },
  history: { label: "History", Component: HistoryView },
};

// Two pages don't justify a router dependency; plain state is enough. If deep links
// are ever needed, swap this for react-router without touching the pages.
export default function App() {
  const [page, setPage] = useState("detect");
  const { Component } = PAGES[page];

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Detecto</h1>
        <nav className="app__nav" aria-label="Pages">
          {Object.entries(PAGES).map(([key, { label }]) => (
            <button
              key={key}
              type="button"
              className="app__nav-button"
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="app__main">
        <Component />
      </main>
    </div>
  );
}
