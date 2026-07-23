import React, { useState } from 'react';
import GraphExplorer from './components/GraphExplorer';
import SearchView from './components/SearchView';
import Dashboard from './components/Dashboard';

type Tab = 'graph' | 'search' | 'dashboard';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('graph');

  return (
    <div className="app">
      <header className="app-header">
        <h1>Code Analyzer</h1>
        <nav className="tab-nav">
          {(['graph', 'search', 'dashboard'] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'active' : ''}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'graph' ? 'Graph' : tab === 'search' ? 'Search' : 'Dashboard'}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {activeTab === 'graph' && <GraphExplorer />}
        {activeTab === 'search' && <SearchView />}
        {activeTab === 'dashboard' && <Dashboard />}
      </main>
    </div>
  );
};

export default App;
