import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useDevices } from '../hooks/useDevices';
import { auth } from '../config/firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { LogOut, Activity, Smartphone, Signal, Shield } from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuth();
  const { devices, loading, error } = useDevices(user?.uid);
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  if (!user) return null; // Route protection handles this

  const activeCount = devices.filter(d => d.online).length;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-slate-700/50 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-2">
              <Shield className="w-6 h-6 text-primary" />
              <span className="font-bold text-lg">PhoneRakshak Dashboard</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-secondary hidden sm:inline-block">
                UID: {user.uid.substring(0,8)}...
              </span>
              <button onClick={handleLogout} className="flex items-center space-x-1 text-sm hover:text-red-400 transition-colors">
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="glass-card p-6 flex items-center space-x-4">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <Smartphone className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{devices.length}</div>
              <div className="text-sm text-secondary">Total Devices</div>
            </div>
          </div>

          <div className="glass-card p-6 flex items-center space-x-4">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <Activity className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{activeCount}</div>
              <div className="text-sm text-secondary">Online Now</div>
            </div>
          </div>

          <div className="glass-card p-6 flex items-center space-x-4">
            <div className="p-3 bg-red-500/10 rounded-lg">
              <Signal className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{devices.length - activeCount}</div>
              <div className="text-sm text-secondary">Offline Devices</div>
            </div>
          </div>
        </div>

        {/* Devices Table */}
        <div className="glass-card overflow-hidden">
          <div className="p-6 border-b border-slate-700/50 flex justify-between items-center">
            <h2 className="text-lg font-semibold">Registered Devices</h2>
            {loading && <span className="text-sm text-primary animate-pulse">Syncing realtime...</span>}
          </div>
          
          {error && <div className="p-4 bg-red-500/10 text-red-400 text-sm">{error}</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/50 text-secondary uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">Device ID</th>
                  <th className="px-6 py-4 font-medium">Model</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium">Last Seen</th>
                  <th className="px-6 py-4 font-medium">Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {devices.length === 0 && !loading && (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-secondary">
                      No devices registered. Install the app to sync.
                    </td>
                  </tr>
                )}
                {devices.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs">{device.id}</td>
                    <td className="px-6 py-4">{device.deviceModel || 'Unknown'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${device.online ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-400'}`}>
                        {device.online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-6 py-4">
                      <span className="uppercase text-xs font-semibold tracking-wider text-purple-400">
                        {device.subscriptionTier || 'Free'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
}
