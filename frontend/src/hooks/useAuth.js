import { useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log("Auth state changed:", currentUser?.uid);
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { user, loading };
};
