import { useEffect, useState } from 'react';
import { Sun, Moon, BookOpen, Library, Sparkles, Coffee } from 'lucide-react';
import { BookList } from './components/BookList';
import { BookReader, Book } from './components/BookReader';
import { VocabularyManager } from './components/VocabularyManager';
import { useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';

function App() {
  const { user, isAuthenticated, loading: authLoading, fetchWithAuth, logout } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('dark');
  const [activeTab, setActiveTab] = useState<'library' | 'vocab'>('library');

  // Load Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'sepia' | null;
    const currentTheme = savedTheme || 'dark';
    setTheme(currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
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
          
          // Restore active book if saved in localStorage
          const savedActiveBookId = localStorage.getItem('readthrough_active_book_id');
          if (savedActiveBookId) {
            const restoredBook = resJson.data.find((b: Book) => b.id === savedActiveBookId);
            if (restoredBook) {
              setActiveBook(restoredBook);
            }
          }
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

  // Sync state if activeBook has updated
  useEffect(() => {
    if (activeBook) {
      const current = books.find(b => b.id === activeBook.id);
      if (current) setActiveBook(current);
    }
  }, [books]);

  const toggleTheme = () => {
    let nextTheme: 'light' | 'dark' | 'sepia' = 'light';
    if (theme === 'light') nextTheme = 'dark';
    else if (theme === 'dark') nextTheme = 'sepia';
    else if (theme === 'sepia') nextTheme = 'light';

    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  };

  const handleSelectBook = (book: Book) => {
    setActiveBook(book);
    localStorage.setItem('readthrough_active_book_id', book.id);
  };

  const handleBackToLibrary = () => {
    setActiveBook(null);
    localStorage.removeItem('readthrough_active_book_id');
    fetchBooks();
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

  if (!isAuthenticated) {
    return <LoginScreen theme={theme} onThemeChange={toggleTheme} />;
  }

  return (
    <div className="app-shell">
      {activeBook ? (
        // Reader mode — no global navbar, reader has its own toolbar
        <BookReader 
          book={activeBook} 
          onBack={handleBackToLibrary} 
          theme={theme}
          onThemeChange={toggleTheme}
        />
      ) : (
        <>
          {/* Navigation Header (Library view only) */}
          <header className="navbar">
            <div className="navbar-brand">
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
            </div>

            <div className="navbar-actions">
              <div className="navbar-hint">
                <Sparkles size={14} />
                <span>Highlight text to translate instantly</span>
              </div>

              <button
                className="icon-btn"
                onClick={toggleTheme}
                title="Switch theme (Light/Dark/Sepia)"
              >
                {theme === 'light' && <Moon size={17} />}
                {theme === 'dark' && <Coffee size={17} />}
                {theme === 'sepia' && <Sun size={17} />}
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
              <button
                className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`}
                onClick={() => setActiveTab('library')}
              >
                <Library size={16} />
                <span>My Library</span>
                <span className="count-badge">{books.length}</span>
              </button>
              <button
                className={`tab-btn ${activeTab === 'vocab' ? 'active' : ''}`}
                onClick={() => setActiveTab('vocab')}
              >
                <Sparkles size={16} />
                <span>Vocabulary Notebook</span>
              </button>
            </div>

            {activeTab === 'library' ? (
              loading && books.length === 0 ? (
                <div className="loading-state">
                  <div className="spinner" />
                  <span>Opening personal library...</span>
                </div>
              ) : (
                <div className="library-view">
                  <BookList
                    books={books}
                    onSelectBook={handleSelectBook}
                    onUploadSuccess={fetchBooks}
                  />
                </div>
              )
            ) : (
              <VocabularyManager books={books} onSelectBook={handleSelectBook} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
