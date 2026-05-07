import { useState, useEffect } from 'react';
import { auth, setupRecaptcha } from '../config/firebase';
import { signInWithPhoneNumber } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setupRecaptcha('recaptcha-container');
  }, []);

  const sendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
      console.log("Sending OTP to:", formattedPhone);
      const confirmation = await signInWithPhoneNumber(auth, formattedPhone, window.recaptchaVerifier);
      setConfirmationResult(confirmation);
      console.log("OTP sent successfully");
    } catch (err) {
      console.error("Error sending OTP:", err);
      setError('Failed to send OTP. Ensure phone format is correct (e.g. +1234567890)');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      console.log("Verifying OTP...");
      await confirmationResult.confirm(otp);
      console.log("OTP verified successfully");
      navigate('/');
    } catch (err) {
      console.error("Error verifying OTP:", err);
      setError('Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">PhoneRakshak</h1>
          <p className="text-secondary">Secure Admin Portal</p>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg mb-6 text-sm">{error}</div>}

        {!confirmationResult ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1234567890"
                className="input-field"
                required
              />
            </div>
            <div id="recaptcha-container"></div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Enter OTP</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                className="input-field"
                required
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
