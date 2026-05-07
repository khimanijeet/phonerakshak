import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useDevices } from '../hooks/useDevices';
import { auth, db } from '../config/firebase';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Shield, CreditCard, Check, Smartphone, LogOut, Star } from 'lucide-react';

export default function CustomerPortal() {
  const { user } = useAuth();
  const { devices, loading: devicesLoading } = useDevices(user?.uid);
  const [subscription, setSubscription] = useState(null);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, `users/${user.uid}/subscription/current`), (docSnap) => {
      if (docSnap.exists()) {
        setSubscription(docSnap.data());
      } else {
        setSubscription({ planType: 'free', active: true }); // Default
      }
    });
    return () => unsub();
  }, [user]);

  const handleUpgrade = async (newPlan) => {
    setIsUpgrading(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      
      await setDoc(doc(db, `users/${user.uid}/subscription/current`), {
        planType: newPlan,
        active: true,
        updatedAt: serverTimestamp()
      }, { merge: true });

      const response = await fetch('/api/subscription/upgrade', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ newPlan })
      });

      if (!response.ok) {
        throw new Error('Backend sync failed');
      }

      alert(`Successfully upgraded to ${newPlan.toUpperCase()}!`);
    } catch (err) {
      console.error(err);
      alert('Subscription sync failed. Please refresh and try again.');
    } finally {
      setIsUpgrading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  if (!user) return null;

  const currentPlan = subscription?.planType || 'free';

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-slate-700/50 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center space-x-2">
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-bold text-lg">PhoneRakshak Portal</span>
          </div>
          <button onClick={handleLogout} className="flex items-center space-x-1 text-sm hover:text-red-400">
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-12">
        
        {/* Devices Section */}
        <section>
          <div className="glass-card p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" /> Registered Devices
            </h2>
            {devices.length === 0 ? (
              <div className="text-secondary py-8 text-center border-2 border-dashed border-slate-700 rounded-lg">
                No devices found. Install PhoneRakshak on your phone to connect.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {devices.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <div>
                      <div className="font-medium">{d.deviceModel || 'Unknown Device'}</div>
                      <div className="text-sm text-secondary font-mono">{d.id}</div>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${d.online ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-400'}`}>
                        {d.online ? 'Online' : 'Offline'}
                      </span>
                      <div className="text-xs text-secondary mt-1">
                        {d.lastSeen ? new Date(d.lastSeen).toLocaleTimeString() : 'Never'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Subscription Section */}
        <section>
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-4">Choose Your Protection Plan</h2>
            <p className="text-secondary max-w-2xl mx-auto">Upgrade to secure more devices and unlock powerful anti-theft tools like fake shutdown protection and intruder selfies.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Free Plan */}
            <div className={`glass-card p-8 flex flex-col relative transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5 ${currentPlan === 'free' ? 'border-primary/50 bg-primary/5' : ''}`}>
              <div className="mb-6">
                <h3 className="text-xl font-bold text-slate-300">Free</h3>
                <div className="mt-4 flex items-baseline text-4xl font-extrabold">
                  ₹0
                  <span className="ml-1 text-xl font-medium text-slate-500">/mo</span>
                </div>
              </div>
              <ul className="space-y-4 mb-8 flex-1 text-sm text-slate-300">
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span><strong>1 Device Limit</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Real-time Location Tracking</span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Remote Alarm / Siren</span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Remote Device Lock</span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Basic Support</span></li>
              </ul>
              {currentPlan === 'free' ? (
                <button disabled className="w-full py-3 px-4 bg-slate-800 text-slate-300 rounded-lg font-bold border border-slate-700">CURRENT PLAN</button>
              ) : (
                <button disabled className="w-full py-3 px-4 bg-slate-800 text-slate-500 rounded-lg font-bold border border-slate-700 cursor-not-allowed">Included</button>
              )}
            </div>

            {/* Plus Plan */}
            <div className={`glass-card p-8 flex flex-col relative transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5 ${currentPlan === 'plus' ? 'border-primary/50 bg-primary/5' : ''}`}>
              <div className="mb-6">
                <h3 className="text-xl font-bold text-blue-400">Plus</h3>
                <div className="mt-4 flex items-baseline text-4xl font-extrabold">
                  ₹99
                  <span className="ml-1 text-xl font-medium text-slate-500">/mo</span>
                </div>
              </div>
              <ul className="space-y-4 mb-8 flex-1 text-sm text-slate-300">
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span><strong>Up to 3 Devices</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Real-time Location Tracking</span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span><strong>Geo-fencing (Safe Zones)</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span><strong>Battery & Offline Alerts</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Remote Alarm & Device Lock</span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Standard Email Support</span></li>
              </ul>
              {currentPlan === 'plus' ? (
                <button disabled className="w-full py-3 px-4 bg-primary/20 text-primary border border-primary/50 rounded-lg font-bold">CURRENT PLAN</button>
              ) : currentPlan === 'premium' ? (
                <button disabled className="w-full py-3 px-4 bg-slate-800 text-slate-500 rounded-lg font-bold border border-slate-700 cursor-not-allowed">Included in Premium</button>
              ) : (
                <button disabled={isUpgrading} onClick={() => handleUpgrade('plus')} className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors">
                  {isUpgrading ? 'Updating...' : 'Upgrade to Plus'}
                </button>
              )}
            </div>

            {/* Premium Plan */}
            <div className={`glass-card p-8 flex flex-col relative transform transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-purple-500/20 border-2 ${currentPlan === 'premium' ? 'border-purple-500 bg-purple-500/10' : 'border-purple-500/50'}`}>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <span className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white text-xs font-bold px-4 py-1 rounded-full uppercase tracking-wider shadow-lg flex items-center gap-1">
                  <Star className="w-3 h-3" /> Most Popular
                </span>
              </div>
              <div className="mb-6 mt-2">
                <h3 className="text-xl font-bold text-purple-400">Premium</h3>
                <div className="mt-4 flex items-baseline text-4xl font-extrabold text-white">
                  ₹199
                  <span className="ml-1 text-xl font-medium text-slate-400">/mo</span>
                </div>
              </div>
              <ul className="space-y-4 mb-8 flex-1 text-sm text-slate-200">
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span><strong>Unlimited Devices</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Real-time Location Tracking</span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-green-400 shrink-0" /><span>Geo-fencing & Smart Alerts</span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-purple-400 shrink-0" /><span><strong>Fake Shutdown Protection</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-purple-400 shrink-0" /><span><strong>Intruder Selfie Capture</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-purple-400 shrink-0" /><span><strong>Live Camera & Audio Access</strong></span></li>
                <li className="flex items-start gap-3"><Check className="w-5 h-5 text-purple-400 shrink-0" /><span><strong>Priority Human Support</strong></span></li>
              </ul>
              {currentPlan === 'premium' ? (
                <button disabled className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg font-bold shadow-lg shadow-purple-500/25 opacity-90 cursor-default">CURRENT PLAN</button>
              ) : (
                <button disabled={isUpgrading} onClick={() => handleUpgrade('premium')} className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white rounded-lg font-bold shadow-lg shadow-purple-500/25 transition-all">
                  {isUpgrading ? 'Updating...' : 'Upgrade to Premium'}
                </button>
              )}
            </div>

          </div>
        </section>

      </main>
    </div>
  );
}
