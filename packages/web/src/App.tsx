import React, { useState } from 'react';
import GraphExplorer from './components/GraphExplorer';
import SearchView from './components/SearchView';
import Dashboard from './components/Dashboard';
import CrossRepoDashboard from './components/CrossRepoDashboard';
import PRReviewPanel from './components/PRReviewPanel';
import RepoGroupManager from './components/RepoGroupManager';

type Tab = 'graph' | 'search' | 'dashboard' | 'cross-repo' | 'pr-review' | 'repo-groups';

const TAB_LABELS: Record<Tab, string> = {
  graph: 'Graph',
  search: 'Search',
  dashboard: 'Dashboard',
  'cross-repo': 'Cross-Repo',
  'pr-review': 'PR Review',
  'repo-groups': 'Repo Groups',
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('graph');

  return (
    <div className="app">
      <header className="app-header">
        <h1>Code Analyzer</h1>
        <nav className="tab-nav">
          {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'active' : ''}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {activeTab === 'graph' && <GraphExplorer />}
        {activeTab === 'search' && <SearchView />}
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'cross-repo' && <CrossRepoDashboard />}
        {activeTab === 'pr-review' && <PRReviewPanel />}
        {activeTab === 'repo-groups' && <RepoGroupManager />}
      </main>
    </div>
  );
};

export default App;
