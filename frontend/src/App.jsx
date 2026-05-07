import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CustomerPortal from './pages/CustomerPortal';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={!user ? <Login /> : <Navigate to="/" />} 
        />
        <Route 
          path="/admin" 
          element={user ? <Dashboard /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/" 
          element={user ? <CustomerPortal /> : <Navigate to="/login" />} 
        />
      </Routes>
    </Router>
  );
}

export default App;
