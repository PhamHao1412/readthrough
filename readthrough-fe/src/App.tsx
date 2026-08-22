import { useEffect, useState } from 'react';
import { BookOpen, Library, Sparkles, Palette } from 'lucide-react';
import { Routes, Route, Navigate, Outlet, useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { BookList } from './components/BookList';
import { BookReader, Book } from './components/BookReader';
import { VocabularyManager } from './components/VocabularyManager';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ReadingStatsView } from './components/ReadingStatsView';
import { useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { ThemeSelectorModal } from './components/ThemeSelectorModal';
import { ThemeId, applyTheme } from './utils/themes';

// ── Protected Route Guard ──
const ProtectedRoute = () => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading account information...</span>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

// ── Public Route Guard (Guest Only) ──
const PublicRoute = () => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return !isAuthenticated ? <Outlet /> : <Navigate to="/" replace />;
};

// ── Main Header & Tab Navigation Layout ──
interface MainLayoutProps {
  theme: ThemeId;
  onThemeChange: () => void;
  booksCount: number;
}

const MainLayout: React.FC<MainLayoutProps> = ({ onThemeChange, booksCount }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const activeTab = location.pathname === '/vocab' ? 'vocab' : 'library';

  return (
    <div className="app-shell">
      {/* Navigation Header */}
      <header className="navbar">
        <div className="navbar-brand">
          <Link to="/" className="brand-link" style={{ display: 'flex', alignItems: 'center', gap: 'inherit', color: 'inherit', textDecoration: 'none' }}>
            <div className="brand-icon">
              <BookOpen size={20} />
            </div>
            <div>
              <div className="brand-title">
                ReadThrough
                <span className="brand-badge">v1.0</span>
              </div>
              <div className="brand-subtitle">Smart Translation Reader</div>
            </div>
          </Link>
        </div>

        <div className="navbar-actions">
          <div className="navbar-hint">
            <Sparkles size={14} />
            <span>Highlight text to translate instantly</span>
          </div>

          <button
            className="icon-btn"
            onClick={onThemeChange}
            title="Theme Presets"
          >
            <Palette size={17} />
          </button>

          {user && (
            <div className="user-profile-menu">
              <div className="user-avatar" title={user.email}>
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="user-info-text">
                <span className="user-username">{user.username}</span>
                <button className="user-logout-btn" onClick={logout}>Logout</button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="content-area">
        {/* Tabs Navigation */}
        <div className="library-tabs">
          <Link
            to="/"
            className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            <Library size={16} />
            <span>My Library</span>
            <span className="count-badge">{booksCount}</span>
          </Link>
          <Link
            to="/vocab"
            className={`tab-btn ${activeTab === 'vocab' ? 'active' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            <Sparkles size={16} />
            <span>Vocabulary Notebook</span>
          </Link>
        </div>

        <Outlet />
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav booksCount={booksCount} />
    </div>
  );
};

// ── Wrapper to Fetch Book Details by ID from URL ──
interface BookReaderWrapperProps {
  theme: ThemeId;
  onThemeChange: () => void;
}

const BookReaderWrapper: React.FC<BookReaderWrapperProps> = ({ theme, onThemeChange }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fetchWithAuth } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!id) return;
    const fetchBookDetail = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetchWithAuth(`/api/v1/books/${id}`);
        if (response.ok) {
          const resJson = await response.json();
          if (resJson.succeeded && resJson.data) {
            setBook(resJson.data);
          } else {
            setError(resJson.message || 'Book not found.');
          }
        } else {
          setError('Failed to fetch book details.');
        }
      } catch (err) {
        console.error('Failed to load book:', err);
        setError('An error occurred while loading the book.');
      } finally {
        setLoading(false);
      }
    };
    fetchBookDetail();
  }, [id, fetchWithAuth]);

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div className="loading-state">
          <div className="spinner" />
          <span>Opening book...</span>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="auth-wrapper">
        <div className="error-state" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--red)', marginBottom: '1.5rem', fontSize: '1.1rem' }}>{error || 'Book not found.'}</p>
          <button
            className="tab-btn active"
            style={{ margin: '0 auto', display: 'flex', alignItems: 'center', gap: '8px' }}
            onClick={() => navigate('/')}
          >
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <BookReader
      book={book}
      onBack={() => navigate('/')}
      theme={theme}
      onThemeChange={onThemeChange}
    />
  );
};

// ── Main App Component ──
function App() {
  const { isAuthenticated, loading: authLoading, fetchWithAuth } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [theme, setTheme] = useState<ThemeId>('dracula');
  const [themeModalOpen, setThemeModalOpen] = useState<boolean>(false);
  const navigate = useNavigate();

  // Load Theme
  useEffect(() => {
    const savedTheme = (localStorage.getItem('theme') as ThemeId) || 'dracula';
    setTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  // Fetch Library Books
  const fetchBooks = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth('/api/v1/books');
      if (response.ok) {
        const resJson = await response.json();
        if (resJson.succeeded && Array.isArray(resJson.data)) {
          setBooks(resJson.data);
        }
      }
    } catch (err) {
      console.error('Failed to connect to API to fetch books:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchBooks();
    }
  }, [isAuthenticated]);

  const handleSelectTheme = (newTheme: ThemeId) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  const openThemeModal = () => {
    setThemeModalOpen(true);
  };

  const handleDeleteBook = async (bookId: string) => {
    if (!confirm('Are you sure you want to delete this book?')) return;
    try {
      const response = await fetchWithAuth(`/api/v1/books/${bookId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        fetchBooks();
      } else {
        alert('Failed to delete book.');
      }
    } catch (err) {
      console.error('Error deleting book:', err);
      alert('An error occurred while deleting the book.');
    }
  };

  if (authLoading) {
    return (
      <div className="auth-wrapper">
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading account information...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <Routes>
        {/* Public Routes */}
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<LoginScreen theme={theme} onThemeChange={openThemeModal} />} />
        </Route>

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          {/* Routes with Shared Main Header Layout */}
          <Route element={<MainLayout theme={theme} onThemeChange={openThemeModal} booksCount={books.length} />}>
            <Route
              path="/"
              element={
                loading && books.length === 0 ? (
                  <div className="loading-state">
                    <div className="spinner" />
                    <span>Opening personal library...</span>
                  </div>
                ) : (
                  <div className="library-view">
                    <BookList
                      books={books}
                      onSelectBook={(book) => navigate(`/books/${book.id}`)}
                      onUploadSuccess={fetchBooks}
                      onDeleteBook={handleDeleteBook}
                    />
                  </div>
                )
              }
            />
            <Route
              path="/vocab"
              element={
                <VocabularyManager
                  books={books}
                  onSelectBook={(book) => navigate(`/books/${book.id}`)}
                />
              }
            />
            <Route
              path="/stats"
              element={<ReadingStatsView />}
            />
          </Route>

          {/* Fullscreen Reader Route */}
          <Route
            path="/books/:id"
            element={<BookReaderWrapper theme={theme} onThemeChange={openThemeModal} />}
          />
        </Route>

        {/* Catch-all Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Theme Presets Modal */}
      <ThemeSelectorModal
        isOpen={themeModalOpen}
        onClose={() => setThemeModalOpen(false)}
        currentTheme={theme}
        onSelectTheme={handleSelectTheme}
      />
    </>
  );
}

export default App;
