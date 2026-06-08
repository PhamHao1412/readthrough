import React, { useState } from 'react';
import { BookOpen, User, Mail, Lock, ArrowRight, AlertCircle, Loader2, Sun, Moon, Coffee } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface LoginScreenProps {
  theme: 'light' | 'dark' | 'sepia';
  onThemeChange: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ theme, onThemeChange }) => {
  const { login, signup } = useAuth();
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  
  // Form fields
  const [username, setUsername] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    if (!isLogin) {
      if (!email.trim()) {
        setError('Please enter email address.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters long.');
        return;
      }
    }

    setLoading(true);
    try {
      if (isLogin) {
        await login(username.trim(), password);
      } else {
        await signup(username.trim(), email.trim(), password);
        // Switch to login after successful signup
        setIsLogin(true);
        setPassword('');
        setConfirmPassword('');
        setError('');
        alert('Registration successful! Please login.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred, please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError('');
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="auth-wrapper">
      {/* Background elements */}
      <div className="auth-bg-glow auth-bg-glow-1"></div>
      <div className="auth-bg-glow auth-bg-glow-2"></div>

      <header className="auth-header">
        <button
          className="icon-btn theme-toggle"
          onClick={onThemeChange}
          title="Switch theme (Light/Dark/Sepia)"
        >
          {theme === 'light' && <Moon size={17} />}
          {theme === 'dark' && <Coffee size={17} />}
          {theme === 'sepia' && <Sun size={17} />}
        </button>
      </header>

      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-card-header">
            <div className="auth-brand-logo">
              <BookOpen size={28} />
            </div>
            <h1 className="auth-title">ReadThrough</h1>
            <p className="auth-subtitle">Smart Translation Reader</p>
          </div>

          <div className="auth-tabs">
            <button
              className={`auth-tab ${isLogin ? 'active' : ''}`}
              onClick={() => { if (!isLogin) toggleMode(); }}
              disabled={loading}
            >
              Login
            </button>
            <button
              className={`auth-tab ${!isLogin ? 'active' : ''}`}
              onClick={() => { if (isLogin) toggleMode(); }}
              disabled={loading}
            >
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && (
              <div className="auth-error-alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="auth-form-group">
              <label htmlFor="username">Username</label>
              <div className="auth-input-wrapper">
                <User size={16} className="auth-input-icon" />
                <input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            {!isLogin && (
              <div className="auth-form-group">
                <label htmlFor="email">Email</label>
                <div className="auth-input-wrapper">
                  <Mail size={16} className="auth-input-icon" />
                  <input
                    id="email"
                    type="email"
                    placeholder="example@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
            )}

            <div className="auth-form-group">
              <label htmlFor="password">Password</label>
              <div className="auth-input-wrapper">
                <Lock size={16} className="auth-input-icon" />
                <input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {!isLogin && (
              <div className="auth-form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="auth-input-wrapper">
                  <Lock size={16} className="auth-input-icon" />
                  <input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
            )}

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={16} className="auth-spinner" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <span>{isLogin ? 'Login' : 'Create Account'}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
