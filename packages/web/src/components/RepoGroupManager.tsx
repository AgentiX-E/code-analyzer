import React, { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepoInfo {
  owner: string;
  name: string;
  fullName: string;
  role: 'primary' | 'dependency' | 'consumer';
  localPath?: string;
  indexed?: boolean;
  nodeCount?: number;
  edgeCount?: number;
}

interface RepoGroup {
  id: string;
  name: string;
  description: string;
  repos: RepoInfo[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Demo Data
// ---------------------------------------------------------------------------

const DEMO_GROUPS: RepoGroup[] = [
  {
    id: 'group-1',
    name: 'Microservices Platform',
    description: 'Core microservices that power the platform backend',
    repos: [
      { owner: 'org', name: 'api-gateway', fullName: 'org/api-gateway', role: 'primary' },
      { owner: 'org', name: 'user-service', fullName: 'org/user-service', role: 'dependency' },
      { owner: 'org', name: 'shared-lib', fullName: 'org/shared-lib', role: 'dependency' },
    ],
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-20T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// RepoGroupManager Component
// ---------------------------------------------------------------------------

const RepoGroupManager: React.FC = () => {
  const [groups, setGroups] = useState<RepoGroup[]>(DEMO_GROUPS);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [newRepoRole, setNewRepoRole] = useState<'primary' | 'dependency' | 'consumer'>('dependency');

  const currentGroup = groups.find((g) => g.id === selectedGroup) ?? null;

  const handleCreateGroup = useCallback(() => {
    if (!newGroupName.trim()) return;
    const group: RepoGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      description: newGroupDesc.trim(),
      repos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setGroups([...groups, group]);
    setNewGroupName('');
    setNewGroupDesc('');
    setShowCreate(false);
    setSelectedGroup(group.id);
  }, [newGroupName, newGroupDesc, groups]);

  const handleAddRepo = useCallback(() => {
    if (!newRepoUrl.trim() || !selectedGroup) return;
    // Parse owner/repo from URL or input
    const match = newRepoUrl.match(/github\.com\/([^/]+)\/([^/\s.#?]+)/)
      ?? newRepoUrl.match(/^([^/]+)\/([^/\s]+)$/);
    if (!match) return;

    const owner = match[1]!;
    const name = match[2]!;

    const repo: RepoInfo = {
      owner,
      name,
      fullName: `${owner}/${name}`,
      role: newRepoRole,
    };

    setGroups(groups.map((g) => {
      if (g.id !== selectedGroup) return g;
      return { ...g, repos: [...g.repos, repo], updatedAt: new Date().toISOString() };
    }));
    setNewRepoUrl('');
  }, [newRepoUrl, newRepoRole, selectedGroup, groups]);

  const handleDeleteGroup = useCallback((id: string) => {
    setGroups(groups.filter((g) => g.id !== id));
    if (selectedGroup === id) setSelectedGroup(null);
  }, [groups, selectedGroup]);

  const handleRemoveRepo = useCallback((fullName: string) => {
    if (!selectedGroup) return;
    setGroups(groups.map((g) => {
      if (g.id !== selectedGroup) return g;
      return { ...g, repos: g.repos.filter((r) => r.fullName !== fullName), updatedAt: new Date().toISOString() };
    }));
  }, [selectedGroup, groups]);

  return (
    <div className="repo-group-manager">
      <div className="manager-layout">
        {/* Group List Sidebar */}
        <div className="group-sidebar">
          <div className="sidebar-header">
            <h3>Repo Groups</h3>
            <button className="btn-primary btn-small" onClick={() => setShowCreate(true)}>
              + New
            </button>
          </div>

          {showCreate && (
            <div className="create-form">
              <input
                type="text"
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="input-field"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                className="input-field"
              />
              <div className="form-actions">
                <button className="btn-primary btn-small" onClick={handleCreateGroup}>
                  Create
                </button>
                <button className="btn-secondary btn-small" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="group-list">
            {groups.map((group) => (
              <div
                key={group.id}
                className={`group-item ${selectedGroup === group.id ? 'active' : ''}`}
                onClick={() => setSelectedGroup(group.id)}
              >
                <div className="group-name">{group.name}</div>
                <div className="group-meta">
                  {group.repos.length} repos
                  <button
                    className="btn-danger-icon"
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }}
                    title="Delete group"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Group Detail */}
        <div className="group-detail">
          {currentGroup ? (
            <>
              <div className="detail-header">
                <div>
                  <h3>{currentGroup.name}</h3>
                  <p className="text-muted">{currentGroup.description}</p>
                </div>
                <div className="detail-meta">
                  <span className="meta-item">Created: {new Date(currentGroup.createdAt).toLocaleDateString()}</span>
                  <span className="meta-item">{currentGroup.repos.length} repositories</span>
                </div>
              </div>

              {/* Add Repo Form */}
              <div className="add-repo-form">
                <input
                  type="text"
                  placeholder="GitHub URL or owner/repo"
                  value={newRepoUrl}
                  onChange={(e) => setNewRepoUrl(e.target.value)}
                  className="input-field"
                />
                <select
                  value={newRepoRole}
                  onChange={(e) => setNewRepoRole(e.target.value as typeof newRepoRole)}
                  className="input-select"
                >
                  <option value="primary">Primary</option>
                  <option value="dependency">Dependency</option>
                  <option value="consumer">Consumer</option>
                </select>
                <button className="btn-primary btn-small" onClick={handleAddRepo}>
                  Add Repo
                </button>
              </div>

              {/* Repo List */}
              <div className="repo-list">
                <h4>Repositories</h4>
                {currentGroup.repos.length === 0 ? (
                  <p className="text-muted">No repos added yet. Add one above.</p>
                ) : (
                  currentGroup.repos.map((repo) => (
                    <div key={repo.fullName} className="repo-item">
                      <div className="repo-info">
                        <span className="repo-name">{repo.fullName}</span>
                        <span className={`role-badge role-${repo.role}`}>{repo.role}</span>
                        {repo.indexed && <span className="status-badge indexed">indexed</span>}
                      </div>
                      <div className="repo-stats">
                        {repo.nodeCount !== undefined && (
                          <span>{repo.nodeCount} nodes</span>
                        )}
                        {repo.edgeCount !== undefined && (
                          <span>{repo.edgeCount} edges</span>
                        )}
                      </div>
                      <button
                        className="btn-danger-icon"
                        onClick={() => handleRemoveRepo(repo.fullName)}
                        title="Remove repo"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Actions */}
              <div className="detail-actions">
                <button className="btn-primary">Index All Repos</button>
                <button className="btn-secondary">Sync from GitHub</button>
                <button className="btn-secondary">Export Config</button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>Select a Group</h3>
              <p className="text-muted">
                Choose an existing repo group from the sidebar or create a new one
                to start managing cross-repo analysis.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepoGroupManager;
