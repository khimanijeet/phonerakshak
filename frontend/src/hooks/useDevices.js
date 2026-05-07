import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';

export const useDevices = (uid) => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    console.log(`Setting up snapshot listener for users/${uid}/devices`);
    const q = query(collection(db, `users/${uid}/devices`), orderBy('lastSeen', 'desc'));
    
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const devs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        console.log("Received device update:", devs.length, "devices");
        setDevices(devs);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching devices:", err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      console.log(`Cleaning up snapshot listener for users/${uid}/devices`);
      unsubscribe();
    };
  }, [uid]);

  return { devices, loading, error };
};
